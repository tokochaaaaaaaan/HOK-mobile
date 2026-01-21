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
  const [minStops, setMinStops] = useState<number | null>(null);
  const [startPhase, setStartPhase] = useState<"solo" | "discussion">("solo");

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  // ルームから minStops と startPhase を取得
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    (async () => {
      const snap = await getDoc(doc(db, "rooms", roomId));
      if (snap.exists()) {
        const data = snap.data();
        setMinStops(data.minStops ?? null);
        setStartPhase(data.startPhase ?? "solo");
      }
    })();
  }, [roomId]);

  // 「開始する」ボタン - startPhaseに応じて遷移先を決定
  const handleStart = () => {
    if (startPhase === "discussion") {
      router.push(`/room/${roomId}/discussion`);
    } else {
      router.push(`/room/${roomId}/play`);
    }
  };

  return (
    <div className={styles.fullscreenOverlay}>
      <div className={styles.overlayText}>
        今回の旅行では最低でも{minStops ?? "..."}ヶ所周遊します
      </div>
      <button className={styles.startBtn} onClick={handleStart}>
        開始する
      </button>
    </div>
  );
}
