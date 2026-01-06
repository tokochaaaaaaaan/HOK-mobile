// このコードをブラウザのコンソールで実行してください
// または、任意のページに一時的に追加して実行

import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";

async function fetchBUserLogs() {
  const roomId = "DXSAGJLU";
  const userName = "B";
  
  const q = query(
    collection(db, "rooms", roomId, "logs"),
    where("user", "==", userName)
  );
  
  const snapshot = await getDocs(q);
  
  const logs = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  
  console.log("ユーザーBのログデータ:", logs);
  console.log("JSON:", JSON.stringify(logs, null, 2));
  
  return logs;
}

// 実行
fetchBUserLogs();
