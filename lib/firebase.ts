import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

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

const app = initializeApp(firebaseConfig);

// 各Firebaseサービスの初期化
export const db = getFirestore(app);           // Firestore - 構造化データ
export const rtdb = getDatabase(app);          // Realtime Database - リアルタイム同期
export const storage = getStorage(app);        // Storage - ファイル保存
export const auth = getAuth(app);              // Authentication - ユーザー認証
export const functions = getFunctions(app);    // Functions - サーバーサイド処理

export default app;
