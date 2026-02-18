// src/app/room/[roomId]/second/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import styles from "./page.module.css";

export default function SecondPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const [startPhase, setStartPhase] = useState<"mobile" | "solo" | "discussion">("mobile");

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  // ルームから minStops と startPhase を取得
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    (async () => {
      const snap = await getDoc(doc(db, "rooms", roomId));
      if (snap.exists()) {
        const data = snap.data();
        setStartPhase(data.startPhase ?? "mobile");
      }
    })();
  }, [roomId]);

  // 「開始する」ボタン - mobile1に遷移
  const handleStart = () => {
    router.push(`/room/${roomId}/mobile1`);
  };

  return (
    <div className={styles.fullscreenOverlay}>
      <div className={styles.overlayText}>
        準備ができたら開始してください
      </div>
      <button className={styles.startBtn} onClick={handleStart}>
        開始する
      </button>
    </div>
  );
}
