// Firebase各サービスの最適な使い分けを管理するユーティリティ（動的インポート版）

import { 
  doc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  collection,
  query,
  where,
  limit,
  getDocs
} from "firebase/firestore";
import { 
  ref, 
  set, 
  onValue, 
  serverTimestamp as rtdbServerTimestamp,
  off
} from "firebase/database";
import { 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL
} from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { 
  signInAnonymously, 
  onAuthStateChanged, 
  User 
} from "firebase/auth";

// Firebase設定を動的インポート
let firebaseInstance: any = null;

const getFirebaseInstance = async () => {
  if (!firebaseInstance && typeof window !== 'undefined') {
    firebaseInstance = await import("./firebase");
  }
  return firebaseInstance;
};

// ===========================================
// 1. Authentication - ユーザー管理
// ===========================================

export const signInUser = async (): Promise<User | null> => {
  try {
    const firebase = await getFirebaseInstance();
    if (!firebase) return null;
    const result = await signInAnonymously(firebase.auth);
    return result.user;
  } catch (error) {
    console.error("Authentication error:", error);
    return null;
  }
};

export const onAuthChanged = async (callback: (user: User | null) => void) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return () => {};
  return onAuthStateChanged(firebase.auth, callback);
};

// ===========================================
// 2. Realtime Database - リアルタイム同期データ
// ===========================================

// ルーム参加者のリアルタイム状態（オンライン/オフライン）
export const updateUserPresence = async (roomId: string, userId: string, isOnline: boolean) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return;
  const presenceRef = ref(firebase.rtdb, `presence/${roomId}/${userId}`);
  return set(presenceRef, {
    online: isOnline,
    lastSeen: rtdbServerTimestamp(),
    timestamp: Date.now()
  });
};

export const listenToPresence = async (roomId: string, callback: (presenceData: Record<string, any>) => void) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return () => {};
  const presenceRef = ref(firebase.rtdb, `presence/${roomId}`);
  onValue(presenceRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  });
  return () => off(presenceRef);
};

// プレイ中のリアルタイム進捗状況
export const updatePlayProgress = async (roomId: string, userId: string, progress: Record<string, any>) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return;
  const progressRef = ref(firebase.rtdb, `play_progress/${roomId}/${userId}`);
  return set(progressRef, {
    ...progress,
    lastUpdated: rtdbServerTimestamp(),
    timestamp: Date.now()
  });
};

export const listenToPlayProgress = async (roomId: string, callback: (progressData: Record<string, any>) => void) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return () => {};
  const progressRef = ref(firebase.rtdb, `play_progress/${roomId}`);
  onValue(progressRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || {});
  });
  return () => off(progressRef);
};

// ===========================================
// 3. Firestore - 構造化データ・複雑なクエリ
// ===========================================

// ユーザーの最終選択結果（構造化データ）
export const saveFinalSelection = async (roomId: string, userId: string, selectionData: Record<string, any>) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return;
  const selectionRef = doc(firebase.db, "rooms", roomId, "finalSelections", userId);
  return await setDoc(selectionRef, {
    user: userId,
    ...selectionData,
    savedAt: new Date()
  });
};

// ===========================================
// 4. Functions - サーバーサイド処理
// ===========================================

// 合致率計算（重い処理をサーバーサイドで実行）
export const calculateMatchPercentage = async (data: Record<string, any>) => {
  const firebase = await getFirebaseInstance();
  if (!firebase) return null;
  const func = httpsCallable(firebase.functions, 'calculateMatchPercentage');
  return await func(data);
};

// ===========================================
// 5. クォータ制限対策
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
