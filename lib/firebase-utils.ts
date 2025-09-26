// Firebase各サービスの最適な使い分けを管理するユーティリティ

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
  getDocs
} from "firebase/firestore";
import { 
  ref, 
  set, 
  onValue, 
  push, 
  serverTimestamp as rtdbServerTimestamp,
  off
} from "firebase/database";
import { 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";

import { db, rtdb, storage, auth, functions } from "./firebase";

// ===========================================
// 1. Authentication - ユーザー管理
// ===========================================

export const signInUser = async (): Promise<User | null> => {
  try {
    const result = await signInAnonymously(auth);
    return result.user;
  } catch (error) {
    console.error("Authentication error:", error);
    return null;
  }
};

export const onAuthChanged = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};

// ===========================================
// 2. Realtime Database - リアルタイム同期データ
// ===========================================

// ルーム参加者のリアルタイム状態（オンライン/オフライン）
export const updateUserPresence = (roomId: string, userId: string, isOnline: boolean) => {
  const presenceRef = ref(rtdb, `presence/${roomId}/${userId}`);
  return set(presenceRef, {
    online: isOnline,
    lastSeen: rtdbServerTimestamp(),
    timestamp: Date.now()
  });
};

export const listenToPresence = (roomId: string, callback: (presenceData: any) => void) => {
  const presenceRef = ref(rtdb, `presence/${roomId}`);
  onValue(presenceRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  });
  return () => off(presenceRef);
};

// プレイ中のリアルタイム進捗状況
export const updatePlayProgress = (roomId: string, userId: string, progress: any) => {
  const progressRef = ref(rtdb, `play_progress/${roomId}/${userId}`);
  return set(progressRef, {
    ...progress,
    lastUpdated: rtdbServerTimestamp(),
    timestamp: Date.now()
  });
};

export const listenToPlayProgress = (roomId: string, callback: (progressData: any) => void) => {
  const progressRef = ref(rtdb, `play_progress/${roomId}`);
  onValue(progressRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  });
  return () => off(progressRef);
};

// カードドラッグ中のリアルタイム位置情報
export const updateCardDragPosition = (roomId: string, userId: string, dragData: any) => {
  const dragRef = ref(rtdb, `card_drag/${roomId}/${userId}`);
  return set(dragRef, {
    ...dragData,
    timestamp: Date.now()
  });
};

export const listenToCardDrag = (roomId: string, callback: (dragData: any) => void) => {
  const dragRef = ref(rtdb, `card_drag/${roomId}`);
  onValue(dragRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  });
  return () => off(dragRef);
};

// ===========================================
// 3. Firestore - 構造化データ・複雑なクエリ
// ===========================================

// ルーム基本情報（構造化データ）
export const createRoom = async (roomData: any) => {
  const roomRef = doc(db, "rooms", roomData.id);
  return await setDoc(roomRef, {
    ...roomData,
    createdAt: new Date(),
    status: "waiting"
  });
};

export const updateRoomStatus = async (roomId: string, status: string) => {
  const roomRef = doc(db, "rooms", roomId);
  return await updateDoc(roomRef, { status, updatedAt: new Date() });
};

// ユーザーの最終選択結果（構造化データ）
export const saveFinalSelection = async (roomId: string, userId: string, selectionData: any) => {
  const selectionRef = doc(db, "rooms", roomId, "finalSelections", userId);
  return await setDoc(selectionRef, {
    user: userId,
    ...selectionData,
    savedAt: new Date()
  });
};

// 合致率計算結果のキャッシュ
export const saveMatchResults = async (roomId: string, matchResults: any[]) => {
  const resultRef = doc(db, "rooms", roomId, "analytics", "matchResults");
  return await setDoc(resultRef, {
    results: matchResults,
    calculatedAt: new Date(),
    participantCount: matchResults.length
  });
};

export const getMatchResults = async (roomId: string) => {
  const resultRef = doc(db, "rooms", roomId, "analytics", "matchResults");
  const unsubscribe = onSnapshot(resultRef, (doc) => {
    return doc.exists() ? doc.data() : null;
  });
  return unsubscribe;
};

// プレイログの効率的な保存
export const savePlayLog = async (roomId: string, userId: string, logData: any) => {
  const logRef = doc(db, "rooms", roomId, "logs", `${userId}_${Date.now()}`);
  return await setDoc(logRef, {
    user: userId,
    ...logData,
    timestamp: new Date()
  });
};

// ===========================================
// 4. Storage - ファイル保存
// ===========================================

// カード画像の最適化キャッシュ
export const uploadOptimizedCardImage = async (cardId: string, imageBlob: Blob) => {
  const imageRef = storageRef(storage, `optimized_cards/${cardId}.webp`);
  const snapshot = await uploadBytes(imageRef, imageBlob);
  return await getDownloadURL(snapshot.ref);
};

// ユーザーアバター画像
export const uploadUserAvatar = async (userId: string, imageBlob: Blob) => {
  const avatarRef = storageRef(storage, `avatars/${userId}.jpg`);
  const snapshot = await uploadBytes(avatarRef, imageBlob);
  return await getDownloadURL(snapshot.ref);
};

// ルーム結果のPDF出力
export const uploadResultPDF = async (roomId: string, pdfBlob: Blob) => {
  const pdfRef = storageRef(storage, `results/${roomId}_result.pdf`);
  const snapshot = await uploadBytes(pdfRef, pdfBlob);
  return await getDownloadURL(snapshot.ref);
};

// ===========================================
// 5. Functions - サーバーサイド処理
// ===========================================

// 合致率計算（重い処理をサーバーサイドで実行）
export const calculateMatchPercentage = httpsCallable(functions, 'calculateMatchPercentage');

// ルーム分析レポート生成
export const generateRoomAnalytics = httpsCallable(functions, 'generateRoomAnalytics');

// 通知送信
export const sendNotification = httpsCallable(functions, 'sendNotification');

// プレイデータの集計・統計
export const aggregatePlayData = httpsCallable(functions, 'aggregatePlayData');

// ===========================================
// 6. データ分散戦略
// ===========================================

export const DataDistributionStrategy = {
  // Realtime Database: 高頻度更新、リアルタイム同期が必要
  realtimeData: [
    'user_presence',      // ユーザーのオンライン状態
    'play_progress',      // プレイ進捗状況
    'card_drag_position', // ドラッグ中の座標
    'typing_indicators',  // 入力中表示
    'live_reactions'      // リアルタイムリアクション
  ],
  
  // Firestore: 構造化データ、複雑なクエリ、トランザクション
  firestoreData: [
    'room_settings',      // ルーム設定
    'final_selections',   // 最終選択結果
    'user_profiles',      // ユーザープロフィール
    'play_logs',          // プレイログ（検索・分析用）
    'match_analytics'     // 合致率分析結果
  ],
  
  // Storage: ファイル、画像、大容量データ
  storageData: [
    'card_images',        // カード画像
    'user_avatars',       // ユーザーアバター
    'result_pdfs',        // 結果PDF
    'cached_thumbnails'   // サムネイルキャッシュ
  ],
  
  // Functions: 重い計算、バッチ処理、外部API連携
  functionsProcessing: [
    'match_calculation',  // 合致率計算
    'analytics_generation', // 分析レポート生成
    'notification_sending', // 通知送信
    'data_aggregation'    // データ集計
  ]
};

// ===========================================
// 7. クォータ制限対策
// ===========================================

// 読み取り回数を最小化するキャッシュ機能
const cache = new Map();

export const getCachedData = (key: string, ttl: number = 5000) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  return null;
};

export const setCachedData = (key: string, data: any) => {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
};

// バッチ読み取りでFirestore読み取り回数を削減
export const batchGetUserSelections = async (roomId: string, userIds: string[]) => {
  const cacheKey = `selections_${roomId}_${userIds.join(',')}`;
  const cached = getCachedData(cacheKey);
  if (cached) return cached;

  const q = query(
    collection(db, "rooms", roomId, "finalSelections"),
    where("user", "in", userIds),
    limit(10)
  );
  
  const snapshot = await getDocs(q);
  const selections = snapshot.docs.map(doc => doc.data());
  
  setCachedData(cacheKey, selections);
  return selections;
};

// リアルタイムリスナーの効率的な管理
export class ListenerManager {
  private listeners: Map<string, () => void> = new Map();

  addListener(key: string, unsubscribe: () => void) {
    this.removeListener(key); // 既存のリスナーを削除
    this.listeners.set(key, unsubscribe);
  }

  removeListener(key: string) {
    const existing = this.listeners.get(key);
    if (existing) {
      existing();
      this.listeners.delete(key);
    }
  }

  removeAllListeners() {
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners.clear();
  }
}

export const globalListenerManager = new ListenerManager();
