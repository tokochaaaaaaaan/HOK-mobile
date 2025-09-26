// Firebase分散設計 - Quota制限対策
// 各サービスの役割を明確に分担し、効率的なデータ管理を実現

import { 
  doc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  writeBatch,
  getDoc
} from "firebase/firestore";
import { 
  ref, 
  set, 
  onValue, 
  push, 
  remove,
  serverTimestamp as rtdbServerTimestamp,
  off
} from "firebase/database";
import { 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject,
  listAll
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";

import { db, rtdb, storage, functions } from "./firebase";

// ===========================================
// データ分散戦略
// ===========================================

/**
 * Firestore: 永続的なデータ・複雑なクエリが必要なデータ
 * - ユーザーの最終選択データ (finalSelections)
 * - ルーム設定・メタデータ
 * - ユーザープロファイル
 * - ゲーム履歴・統計
 */

/**
 * Realtime Database: リアルタイム同期が必要な軽量データ
 * - ユーザープレゼンス（オンライン/オフライン）
 * - プレイ進捗（リアルタイム）
 * - カードドラッグ位置
 * - チャット・通知
 */

/**
 * Storage: ファイル・画像・バックアップデータ
 * - カード画像（既存）
 * - ユーザーアバター
 * - セッション録画データ
 * - データバックアップ
 */

/**
 * Functions: バッチ処理・重い計算・外部API連携
 * - 合致率計算
 * - データ集計・分析
 * - 定期クリーンアップ
 * - メール通知
 */

// ===========================================
// グローバルリスナー管理
// ===========================================
class ListenerManager {
  private listeners: Map<string, (() => void)[]> = new Map();

  addListener(key: string, unsubscribe: () => void) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key)!.push(unsubscribe);
  }

  removeListener(key: string) {
    const listeners = this.listeners.get(key);
    if (listeners) {
      listeners.forEach(unsub => unsub());
      this.listeners.delete(key);
    }
  }

  removeAllListeners() {
    this.listeners.forEach((listeners) => {
      listeners.forEach(unsub => unsub());
    });
    this.listeners.clear();
  }
}

export const globalListenerManager = new ListenerManager();

// ===========================================
// Firestore: 永続データ管理
// ===========================================

// ユーザーの最終選択データの保存（軽量化）
export const saveFinalSelection = async (
  roomId: string,
  userId: string,
  selectionData: {
    want: string[];
    dont: string[];
    reasons: Record<string, string>;
    planName?: string;
    lastUpdated?: Date;
  }
) => {
  const docRef = doc(db, "rooms", roomId, "finalSelections", userId);
  
  // データを圧縮・最適化
  const optimizedData = {
    ...selectionData,
    lastUpdated: new Date(),
    // 理由データを配列形式で圧縮
    reasonsArray: Object.entries(selectionData.reasons).map(([cardId, reason]) => ({
      c: cardId.replace('card', ''), // "card1" -> "1"
      r: reason
    })),
    // 元のreasonsフィールドは削除してサイズ削減
    reasons: undefined
  };

  // 未定義フィールドを削除
  Object.keys(optimizedData).forEach(key => 
    optimizedData[key as keyof typeof optimizedData] === undefined && 
    delete optimizedData[key as keyof typeof optimizedData]
  );

  await setDoc(docRef, optimizedData, { merge: true });
};

// 最終選択データの取得（圧縮データをデコード）
export const getFinalSelection = async (roomId: string, userId: string) => {
  const docRef = doc(db, "rooms", roomId, "finalSelections", userId);
  const docSnap = await getDoc(docRef);
  
  if (!docSnap.exists()) return null;
  
  const data = docSnap.data();
  
  // 圧縮データをデコード
  const reasons: Record<string, string> = {};
  if (data.reasonsArray) {
    data.reasonsArray.forEach(({ c, r }: { c: string; r: string }) => {
      reasons[`card${c}`] = r;
    });
  }
  
  return {
    want: data.want || [],
    dont: data.dont || [],
    reasons,
    planName: data.planName || "",
    lastUpdated: data.lastUpdated
  };
};

// バッチでの選択データ取得（全ユーザー）
export const getAllFinalSelections = async (roomId: string) => {
  const collectionRef = collection(db, "rooms", roomId, "finalSelections");
  const snapshot = await getDocs(collectionRef);
  
  const results: Record<string, any> = {};
  snapshot.forEach(doc => {
    const data = doc.data();
    const reasons: Record<string, string> = {};
    
    if (data.reasonsArray) {
      data.reasonsArray.forEach(({ c, r }: { c: string; r: string }) => {
        reasons[`card${c}`] = r;
      });
    }
    
    results[doc.id] = {
      want: data.want || [],
      dont: data.dont || [],
      reasons,
      planName: data.planName || "",
      lastUpdated: data.lastUpdated
    };
  });
  
  return results;
};

// ルーム設定の管理
export const saveRoomSettings = async (roomId: string, settings: any) => {
  const docRef = doc(db, "rooms", roomId);
  await setDoc(docRef, {
    ...settings,
    lastUpdated: new Date()
  }, { merge: true });
};

// ===========================================
// Realtime Database: リアルタイム同期
// ===========================================

// ユーザープレゼンス管理（自動切断検知付き）
export const updateUserPresence = async (roomId: string, userId: string, isOnline: boolean) => {
  const presenceRef = ref(rtdb, `presence/${roomId}/${userId}`);
  
  if (isOnline) {
    // オンライン時は自動切断検知を設定
    const onlineData = {
      online: true,
      lastSeen: rtdbServerTimestamp(),
      timestamp: Date.now()
    };
    
    await set(presenceRef, onlineData);
    
    // 切断時に自動でオフラインに設定
    const offlineData = {
      online: false,
      lastSeen: rtdbServerTimestamp(),
      timestamp: Date.now()
    };
    
    // onDisconnect設定
    const connectedRef = ref(rtdb, '.info/connected');
    onValue(connectedRef, (snapshot) => {
      if (snapshot.val() === false) {
        set(presenceRef, offlineData);
      }
    });
    
  } else {
    await set(presenceRef, {
      online: false,
      lastSeen: rtdbServerTimestamp(),
      timestamp: Date.now()
    });
  }
};

export const listenToPresence = (roomId: string, callback: (presenceData: any) => void) => {
  const presenceRef = ref(rtdb, `presence/${roomId}`);
  
  const unsubscribe = onValue(presenceRef, (snapshot) => {
    const data = snapshot.val() || {};
    
    // 5分以上更新がないユーザーはオフライン扱い
    const now = Date.now();
    const filteredData = Object.keys(data).reduce((acc, userId) => {
      const userData = data[userId];
      const isRecentlyActive = (now - (userData.timestamp || 0)) < 5 * 60 * 1000; // 5分
      
      acc[userId] = {
        ...userData,
        online: userData.online && isRecentlyActive
      };
      
      return acc;
    }, {} as any);
    
    callback(filteredData);
  });
  
  return () => off(presenceRef);
};

// プレイ進捗の軽量リアルタイム管理
export const updatePlayProgress = async (roomId: string, userId: string, progress: any) => {
  const progressRef = ref(rtdb, `progress/${roomId}/${userId}`);
  
  // データを軽量化
  const lightProgress = {
    stage: progress.stage,
    status: progress.status,
    percent: progress.percent || 0,
    lastAction: progress.lastAction,
    timestamp: Date.now()
  };
  
  await set(progressRef, lightProgress);
};

export const listenToPlayProgress = (roomId: string, callback: (progressData: any) => void) => {
  const progressRef = ref(rtdb, `progress/${roomId}`);
  
  const unsubscribe = onValue(progressRef, (snapshot) => {
    const data = snapshot.val() || {};
    callback(data);
  });
  
  return () => off(progressRef);
};

// リアルタイム通知システム
export const sendNotification = async (roomId: string, notification: {
  type: string;
  message: string;
  fromUser?: string;
  targetUser?: string;
}) => {
  const notificationRef = ref(rtdb, `notifications/${roomId}`);
  const newNotificationRef = push(notificationRef);
  
  await set(newNotificationRef, {
    ...notification,
    timestamp: Date.now(),
    id: newNotificationRef.key
  });
};

export const listenToNotifications = (roomId: string, callback: (notifications: any[]) => void) => {
  const notificationRef = ref(rtdb, `notifications/${roomId}`);
  
  const unsubscribe = onValue(notificationRef, (snapshot) => {
    const data = snapshot.val() || {};
    const notifications = Object.values(data).sort((a: any, b: any) => b.timestamp - a.timestamp);
    callback(notifications);
  });
  
  return () => off(notificationRef);
};

// ===========================================
// Storage: ファイル管理
// ===========================================

// セッションデータのバックアップ
export const backupSessionData = async (roomId: string, sessionData: any) => {
  const backupRef = storageRef(storage, `backups/${roomId}/${Date.now()}.json`);
  const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
  
  await uploadBytes(backupRef, blob);
  return getDownloadURL(backupRef);
};

// ユーザーアバターの管理
export const uploadUserAvatar = async (userId: string, file: File) => {
  const avatarRef = storageRef(storage, `avatars/${userId}/${file.name}`);
  await uploadBytes(avatarRef, file);
  return getDownloadURL(avatarRef);
};

// 古いバックアップファイルのクリーンアップ
export const cleanupOldBackups = async (roomId: string, daysToKeep: number = 7) => {
  const backupRef = storageRef(storage, `backups/${roomId}/`);
  const items = await listAll(backupRef);
  
  const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  
  for (const item of items.items) {
    // ファイル名から timestamp を取得
    const timestamp = parseInt(item.name.split('.')[0]);
    if (timestamp < cutoffTime) {
      await deleteObject(item);
    }
  }
};

// ===========================================
// Functions: バッチ処理・重い計算
// ===========================================

// 合致率の計算（Firebase Functions）
export const calculateMatchRates = async (roomId: string) => {
  const calculateMatchRate = httpsCallable(functions, 'calculateMatchRate');
  
  try {
    const result = await calculateMatchRate({ roomId });
    return result.data;
  } catch (error) {
    console.error('合致率計算エラー:', error);
    
    // Functionsが利用できない場合はクライアントサイドで計算
    return calculateMatchRatesClientSide(roomId);
  }
};

// クライアントサイドでの合致率計算（Functionsのフォールバック）
const calculateMatchRatesClientSide = async (roomId: string) => {
  const allSelections = await getAllFinalSelections(roomId);
  const users = Object.keys(allSelections);
  
  if (users.length < 2) return {};
  
  const matchRates: Record<string, Record<string, number>> = {};
  
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const user1 = users[i];
      const user2 = users[j];
      
      const selection1 = allSelections[user1];
      const selection2 = allSelections[user2];
      
      // 合致カードと不一致カードを計算
      const matchingWants = selection1.want.filter((card: string) => selection2.want.includes(card));
      const conflictingCards = selection1.want.filter((card: string) => selection2.dont.includes(card)) 
        .concat(selection1.dont.filter((card: string) => selection2.want.includes(card)));
      
      const totalCards = [...new Set([...selection1.want, ...selection1.dont, ...selection2.want, ...selection2.dont])];
      const matchRate = totalCards.length > 0 ? 
        ((matchingWants.length - conflictingCards.length) / totalCards.length) * 100 : 0;
      
      if (!matchRates[user1]) matchRates[user1] = {};
      if (!matchRates[user2]) matchRates[user2] = {};
      
      matchRates[user1][user2] = Math.max(0, Math.min(100, matchRate));
      matchRates[user2][user1] = matchRates[user1][user2];
    }
  }
  
  return matchRates;
};

// データ統計の収集（Firebase Functions）
export const collectGameStats = async (roomId: string) => {
  const collectStats = httpsCallable(functions, 'collectGameStats');
  
  try {
    const result = await collectStats({ roomId });
    return result.data;
  } catch (error) {
    console.error('統計収集エラー:', error);
    return null;
  }
};

// 定期クリーンアップの実行（Firebase Functions）
export const triggerCleanup = async () => {
  const cleanup = httpsCallable(functions, 'scheduledCleanup');
  
  try {
    const result = await cleanup();
    return result.data;
  } catch (error) {
    console.error('クリーンアップエラー:', error);
    return null;
  }
};

// ===========================================
// パフォーマンス最適化
// ===========================================

// データプリロード
export const preloadRoomData = async (roomId: string, userId: string) => {
  try {
    // 並列でデータを取得
    const [finalSelection, roomSettings] = await Promise.all([
      getFinalSelection(roomId, userId),
      getDoc(doc(db, "rooms", roomId))
    ]);
    
    return {
      finalSelection,
      roomSettings: roomSettings.exists() ? roomSettings.data() : null
    };
  } catch (error) {
    console.error('データプリロードエラー:', error);
    return null;
  }
};

// キャッシュ管理
class DataCache {
  private cache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();
  
  set(key: string, data: any, ttlMs: number = 5 * 60 * 1000) { // デフォルト5分
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }
  
  get(key: string) {
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > cached.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return cached.data;
  }
  
  clear() {
    this.cache.clear();
  }
}

export const dataCache = new DataCache();

// ===========================================
// エラーハンドリング・ログ
// ===========================================

export const logError = async (error: any, context: string, userId?: string) => {
  console.error(`[${context}] エラー:`, error);
  
  // 本番環境では Firebase Functions でエラーログを収集
  if (process.env.NODE_ENV === 'production') {
    try {
      const logError = httpsCallable(functions, 'logError');
      await logError({
        error: error.message || error.toString(),
        context,
        userId,
        timestamp: Date.now(),
        userAgent: navigator.userAgent
      });
    } catch (logErr) {
      console.error('エラーログ送信失敗:', logErr);
    }
  }
};

// 接続状態の監視
export const monitorConnection = (callback: (isConnected: boolean) => void) => {
  const connectedRef = ref(rtdb, '.info/connected');
  
  const unsubscribe = onValue(connectedRef, (snapshot) => {
    callback(snapshot.val() === true);
  });
  
  return () => off(connectedRef);
};
