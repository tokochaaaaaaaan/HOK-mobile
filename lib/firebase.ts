import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

// Vercel/ローカル環境の判定
const isProduction = process.env.NODE_ENV === "production";
const isVercel = !!process.env.VERCEL;

// Firebase設定（ハードコード保有数を削減し、本来は環境変数化が理想）
const firebaseConfig = {
  apiKey: "AIzaSyBFHEIoWMXun2BCoUd2z9Lv5f_iKNMhpc4",
  authDomain: "hang-out-king.firebaseapp.com",
  databaseURL: "https://hang-out-king-default-rtdb.firebaseio.com",
  projectId: "hang-out-king",
  storageBucket: "hang-out-king.appspot.com",
  messagingSenderId: "1064756850993",
  appId: "1:1064756850993:web:9f2252a2b4189b82978010",
  measurementId: "G-K5TS3B7WXK"
};

// Firebase初期化時のデバッグログ
if (typeof window !== "undefined") {
  console.log('[Firebase] Initializing with config:', {
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    isVercel,
    isProduction,
  });
}

let app: any = null;
let db: any = null;
let rtdb: any = null;
let storage: any = null;
let auth: any = null;
let functions: any = null;

try {
  app = initializeApp(firebaseConfig);
  
  // 各Firebaseサービスの初期化
  db = getFirestore(app);           // Firestore - 構造化データ
  rtdb = getDatabase(app);          // Realtime Database - リアルタイム同期
  storage = getStorage(app);        // Storage - ファイル保存
  auth = getAuth(app);              // Authentication - ユーザー認証
  functions = getFunctions(app);    // Functions - サーバーサイド処理
  
  console.log('[Firebase] Initialization successful');
} catch (error) {
  console.error('[Firebase] Initialization failed:', error);
}

// 注: Firestore persistence を無効にしています
// 理由: 複数タブ・複数リロード時に IndexedDB ロック競合が発生するため
// リアルタイムの onSnapshot により常に最新データを取得するので問題なし

// 初期化が失敗した場合の警告
if (!app) {
  console.warn('[Firebase] ⚠️ Firebase initialization failed! Check your config and network.');
}

export { app, db, rtdb, storage, auth, functions };
export default app;
