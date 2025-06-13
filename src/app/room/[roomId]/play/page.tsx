"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import ShadowCarousel, { Card as CarouselCard } from "@/app/components/ShadowCarousel";
import styles from "./page.module.css";

type LogEntry = {
  id: string;
  message: string;
  card: string;
  polarity: number;
  reason?: string;
};

export default function PlayPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();

  // --- 初期カードプール ---
  const initialCards: CarouselCard[] = Array.from({ length: 10 }, (_, i) => ({
    id: `card${i + 1}`,
    src: `/pngs/USJ_${i + 1}_surface-1.png`,
    title: `カード${i + 1}`,
  }));

  const [cards, setCards] = useState<CarouselCard[]>(initialCards);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [polarity, setPolarity] = useState(3);
  const [reason, setReason] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false); // ← 全カードモーダル表示フラグ

  // Firestore からログをリアルタイム取得
  useEffect(() => {
    if (!roomId) return;
    const q = query(
      collection(db, "rooms", roomId, "logs"),
      orderBy("timestamp", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setLogs(
        snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            message: data.message,
            card: data.card,
            polarity: data.polarity,
            reason: data.reason,
          };
        })
      );
    });
    return () => unsub();
  }, [roomId]);

  // 全カード評価後 自動遷移
  useEffect(() => {
    if (cards.length === 0) {
      router.push(`/room/${roomId}/result`);
    }
  }, [cards, roomId, router]);

  const currentCard = useMemo(() => cards[selectedIndex], [cards, selectedIndex]);

  // 決定
  const handleConfirm = async () => {
    if (!roomId) return;
    await addDoc(collection(db, "rooms", roomId, "logs"), {
      user: userName,
      card: currentCard.title,
      polarity,
      reason: polarity === 1 || polarity === 5 ? reason : null,
      timestamp: serverTimestamp(),
      message:
        `${userName} が「${currentCard.title}」を${polarity}で評価` +
        (polarity === 1 || polarity === 5 ? `（理由: ${reason}）` : ""),
    });
    setCards((prev) => prev.filter((_, i) => i !== selectedIndex));
    setSelectedIndex((i) => (i >= cards.length - 1 ? cards.length - 2 : i));
    setPolarity(3);
    setReason("");
  };

  // 元に戻す
  const handleRevert = async (log: LogEntry) => {
    if (!roomId) return;
    await deleteDoc(doc(db, "rooms", roomId, "logs", log.id));
    setCards((prev) => {
      if (prev.find((c) => c.title === log.card)) return prev;
      const original = initialCards.find((c) => c.title === log.card);
      return original ? [...prev, original] : prev;
    });
  };

  // バー色
  const polarityColors: Record<number, string> = {
    1: "#1565c0",
    2: "#64b5f6",
    3: "#ccc",
    4: "#f48fb1",
    5: "#e53935",
  };

  return (
    <div className={styles.wrapper}>
      {/* 移動ログパネル */}
      <div
        className={styles.logPanel}
        style={{
          maxHeight: logExpanded ? "none" : "200px",
          overflowY: "auto",
        }}
      >
        <h3>移動ログ</h3>
        <ul>
          {logs.map((log) => (
            <li key={log.id}>
              {log.message}{" "}
              <button
                className={styles.revertBtn}
                onClick={() => handleRevert(log)}
              >
                元に戻す
              </button>
            </li>
          ))}
        </ul>
        <button
          className={styles.toggleLogBtn}
          onClick={() => setLogExpanded((f) => !f)}
        >
          {logExpanded ? "閉じる" : "もっと見る"}
        </button>
      </div>

      {/* 大カード ＋ 評価セクション */}
      <div className={styles.mainCardSection}>
        <div className={styles.cardTitle}>{currentCard.title}</div>
        <div className={styles.largeCard}>
          <img src={currentCard.src} alt={currentCard.title} />
        </div>
        <div className={styles.polaritySection}>
          <input
            type="range"
            min={1}
            max={5}
            value={polarity}
            onChange={(e) => setPolarity(+e.target.value)}
            className={styles.polaritySlider}
            style={{ background: polarityColors[polarity] }}
          />
          <div className={styles.polarityLabels}>
            <span>1: 特に行きたくない</span>
            <span>2: 行きたくない</span>
            <span>3: どちらでも良い</span>
            <span>4: 行きたい</span>
            <span>5: 特に行きたい</span>
          </div>
          {(polarity === 1 || polarity === 5) && (
            <textarea
              className={styles.reason}
              placeholder="理由を入力"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <button className={styles.confirmBtn} onClick={handleConfirm}>
            決定
          </button>
        </div>
      </div>

      {/* ３D カルーセル */}
      <ShadowCarousel
        cards={cards}
        radius={200}
        initialSelectedIndex={selectedIndex}
        onSelect={(idx) => setSelectedIndex(idx)}
      />

      {/* 「すべて見る」リンク */}
      <div className={styles.viewAllWrapper}>
        <button
          className={styles.viewAllBtn}
          onClick={() => setShowAll(true)}
        >
          すべて見る
        </button>
      </div>

      {/* モーダル：全カード一覧 */}
      {showAll && (
        <div
          className={styles.modalOverlay}
          onClick={() => setShowAll(false)}
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            {cards.map((c, i) => (
              <div
                key={c.id}
                className={styles.modalCard}
                onClick={() => {
                  setSelectedIndex(i);
                  setShowAll(false);
                }}
              >
                <img src={c.src} alt={c.title} />
                <div className={styles.modalCardTitle}>{c.title}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
