"use client";
import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import { doc, setDoc, onSnapshot, collection } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";

export default function MyCardsPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName, cardPositions } = useUser();

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);

  // 1) OKを押すと自分の結果を送信
  const handleConfirm = async () => {
    if (!roomId || typeof roomId !== 'string') return;
    const resultRef = doc(
      db,
      "rooms",
      roomId,
      "results",
      userName
    );
    await setDoc(resultRef, {
      userName,
      positions: cardPositions,
       ready: true,
       timestamp: new Date(),
     });
     setIsWaiting(true);
  };




  // 2) room ドキュメントを監視 → expectedCount フィールドを取得
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, "rooms", roomId);
    return onSnapshot(roomRef, (snap) => {
      const data = snap.data();
      // 開始前はまだセットされないことに注意
      if (data?.expectedCount != null) {
        setExpectedCount(data.expectedCount);
      }
    });
  }, [roomId]);

  // 3) expectedCount 人の ready 完了を待つ
  useEffect(() => {
    if (!isWaiting || expectedCount == null || !roomId || typeof roomId !== 'string') return;
    const resultsCol = collection(db, "rooms", roomId, "results");
    return onSnapshot(resultsCol, (snap) => {
      const readyCount = snap.docs.filter(d => d.data().ready).length;
      if (readyCount >= expectedCount) {
        router.push(`/room/${roomId}/result`);
      }
    });
  }, [isWaiting, expectedCount, roomId, router]);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>自分のカード整理結果</h1>
      {["行きたい","どちらでもいい","行きたくない"].map(cat => (
        <div key={cat}>
          <h2>{cat}</h2>
          <div style={{ display:"flex", flexWrap:"wrap" }}>
            {cardPositions?.[cat]?.map(src => (
              <img key={src} src={src} style={{ width:80, margin:4 }} />
            ))}
          </div>
        </div>
      ))}

    {!isWaiting ? (
  <button
    onClick={handleConfirm}
    style={{
      marginTop: 32,
      padding: "12px 28px",         // ボタン内側の余白
      fontSize: 18,                 // 文字サイズ
      backgroundColor: "#007BFF",   // 青背景
      color: "#FFFFFF",             // 白文字
      border: "none",               // 枠線なし
      borderRadius: "24px",         // たっぷり丸み
      cursor: "pointer",
      boxShadow: "0 2px 4px rgba(0,0,0,0.2)", 
      transition: "transform 0.1s ease", 
    }}
     onMouseDown={e => (e.currentTarget.style.transform = "scale(0.98)")}
     onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
   >
     OK（確定）
    </button>
        ) : expectedCount != null ? (
          <p>他の参加者を待っています… ({expectedCount}人)</p>
        ) : (
          <p>準備中…</p>
        )}
    </div>
  );
}
