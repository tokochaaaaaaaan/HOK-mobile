"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
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
import MapButton from "@/components/MapButton";
import styles from "./page.module.css";

type LogEntry = {
  id: string;
  user: string;
  message: string;
  card: string;
  polarity: number;
};

// CarouselCard に裏面のパスを紐づける
type PlayPageCard = CarouselCard & { backSrc: string };

export default function PlayPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();

  // ブラウザの戻るボタン無効化
  usePreventBack();

  // カード名定義
  const cardTitles = [
    "ジョーズ",
    "アミティ・ボードウォーク・ゲーム",
    "ウォーターワールド",
    "ザ・ドラゴン・パール",
    "ロンバーズ・ランディング",
    "ロストワールド・レストラン",
    "ジュラシック・パーク・ダイナソー・ミート&グリート",
    "ザ・フライング・ダイナソー",
    "名探偵コナン 4-D ライブ・ショー ~星空の宝石(ジュエル)~",
    "クロミ・ライブ",
    "パークサイド・グリル",
    "SAIDO",
    "デリシャス・ミー！ザ・クッキー・キッチン",
    "スペース・キラー",
    "ミニオン・ハチャメチャ・アイス",
    "ミニオン・ハチャメチャ・ライド",
    "マリオカート ~クッパの挑戦状~",
    "ヨッシー・アドベンチャー",
    "キノピオカフェ",
    "ピットストップ・ポップコーン",
    "三本の箒",
    "オリバンダーの店",
    "ハリー・ポッター・アンド・ザ・フォービドゥン・ジャーニー",
    "フライト・オブ・ザ・ヒッポグリフ",
    "ハリウッド・ドリーム・ザ・ライド",
    "プレイング・ウィズおさるのジョージ",
    "シング・オン・ツアー",
    "スタジオ・スターズ・レストラン",
    "ビバリーヒルズ・ブランジェリー",
    "鬼滅の刃 XRライド ~刀鍛冶の里を疾走せよ~",
    "ハローキティのコーナーカフェ",
    "スヌーピー・バックロット・カフェ",
    "ハローキティのリボン・コレクション",
    "エルモのゴーゴー・スケートボード",
    "エルモのバブル・バブル",
    "エルモのリトル・ドライブ",
    "ハローキティのカップケーキ・ドリーム",
    "ビッグバードのビッグトップ・サーカス",
    "フライング・スヌーピー",
    "モッピーのバルーン・トリップ",
  ];

  // 初期カードプール（40枚）
  const initialCards: PlayPageCard[] = Array.from({ length: 5 }, (_, i) => {
    const idx = i + 1;
    return {
      id: `card${idx}`,
      src: `/pngs/USJ_${idx}_surface-1.png`,
      title: cardTitles[i],
      backSrc: `/pngs/back/USJ_${idx}_back-1.png`,
    };
  });

  const [cards, setCards] = useState<PlayPageCard[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // const [polarity, setPolarity] = useState(2); // for future use
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logExpanded, setLogExpanded] = useState(false);
  const [logVisible, setLogVisible] = useState(true); // ログパネルの表示/非表示
  const [showAll, setShowAll] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  // カードが使い切られたら play2 に飛ばす
  useEffect(() => {
    if (cards.length === 0 && isInitialized && roomId) {
      router.push(`/room/${roomId}/play2`);
    }
  }, [cards.length, isInitialized, roomId, router]);

  // selectedIndex が範囲外になったら最後に合わせる
  useEffect(() => {
    if (selectedIndex >= cards.length && cards.length > 0) {
      setSelectedIndex(cards.length - 1);
    }
    // カードが減ったら必ず表に戻す
    setIsFlipped(false);
  }, [cards.length, selectedIndex]);

  // Firestore から自分の移動ログのみをリアルタイム取得 + リロード対応
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string' || !userName) return;
    
    const q = query(
      collection(db, "rooms", roomId, "logs"),
      orderBy("timestamp", "asc")
    );
    
    const unsub = onSnapshot(q, (snap) => {
      const myLogs = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((l) => l.user === userName);
      
      setLogs(myLogs);

      // 初回のみ：ログから使用済みカードを特定して残りカードを設定
      if (!isInitialized) {
        const usedCardTitles = new Set(myLogs.map(log => log.card));
        const remainingCards = initialCards.filter(card => !usedCardTitles.has(card.title));
        
        setCards(remainingCards);
        setIsInitialized(true);
        
        console.log(`play: リロード復元完了 - 残りカード数: ${remainingCards.length}, 使用済み: ${usedCardTitles.size}`);
      }
    });
    
    return () => unsub();
  }, [roomId, userName, isInitialized, initialCards]);

  const currentCard = useMemo(
    () => cards[selectedIndex] ?? null,
    [cards, selectedIndex]
  );

  // カードが１枚もない or currentCard が無効なら何も描かない
  if (!currentCard) {
    return null;
  }

  // 評価を確定してログを追加
  const handlePolaritySelect = async (selectedPolarity: number) => {
    if (!roomId || typeof roomId !== 'string') return;
    if (!currentCard) return;
    // 二重クリック・連打対策
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    
    const polarityText = {
      1: "行きたくない",
      2: "どちらでもいい", 
      3: "行きたい"
    }[selectedPolarity];

    // データベース用の分類名
    const categoryMapping: Record<number, string> = {
      1: "dont",      // 行きたくない
      2: "neutral",   // どちらでもいい
      3: "want"       // 行きたい
    };

    try {
      await addDoc(collection(db, "rooms", roomId, "logs"), {
        user: userName,
        card: currentCard.title,
        polarity: selectedPolarity,
        category: categoryMapping[selectedPolarity], // データベース用の分類を追加
        timestamp: serverTimestamp(),
        message: `${userName}が「${currentCard.title}」を${polarityText}に選択`,
      });
      // インデックスではなくIDで削除（連打や選択インデックス変化に強い）
      const removeId = currentCard.id;
      setCards((prev) => prev.filter((c) => c.id !== removeId));
    } finally {
      // ほんの短時間ロックを維持して多重イベントを吸収
      setTimeout(() => {
        submitLockRef.current = false;
      }, 200);
      setIsSubmitting(false);
    }
    // setPolarity(2); // for future use
  };

  // 元に戻す（ログの削除＋カード復活）
  const handleRevert = async (log: LogEntry) => {
    if (!roomId || typeof roomId !== 'string') return;
    await deleteDoc(doc(db, "rooms", roomId, "logs", log.id));
    setCards((prev) => {
      if (prev.some((c) => c.title === log.card)) return prev;
      const original = initialCards.find((c) => c.title === log.card);
      return original ? [...prev, original] : prev;
    });
  };

  // const polarityColors: Record<number, string> = {
  //   1: "#64b5f6",
  //   2: "#ccc",
  //   3: "#f48fb1",
  // };

  return (
    <div className={styles.wrapper}>
      {/* 移動ログパネル */}
      {logVisible && (
        <div
          className={styles.logPanel}
          style={{
            maxHeight: logExpanded ? "none" : "200px",
            overflowY: "auto",
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3>移動ログ</h3>
            <button
              className={styles.closeLogBtn}
              onClick={() => setLogVisible(false)}
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              ✕ 閉じる
            </button>
          </div>
          <ul>
            {logs.map((l) => {
              const polarityBadgeClass = {
                1: styles.logBadgeDontWant,
                2: styles.logBadgeNeutral,
                3: styles.logBadgeWantToGo,
              }[l.polarity];
              
              const polarityText = {
                1: "行きたくない",
                2: "どちらでもいい",
                3: "行きたい"
              }[l.polarity];

              return (
                <li key={l.id}>
                  {l.user}が「{l.card}」を
                  <span className={`${styles.logBadge} ${polarityBadgeClass}`}>
                    {polarityText}
                  </span>
                  に選択{" "}
                  <button
                    className={styles.revertBtn}
                    onClick={() => handleRevert(l)}
                  >
                    元に戻す
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            className={styles.toggleLogBtn}
            onClick={() => setLogExpanded((f) => !f)}
          >
            {logExpanded ? "閉じる" : "もっと見る"}
          </button>
        </div>
      )}

      {/* ログが閉じられている時の再表示ボタン */}
      {!logVisible && (
        <button
          onClick={() => setLogVisible(true)}
          style={{
            position: 'fixed',
            top: '80px',
            right: '20px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
            zIndex: 100,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          📋 ログを表示
        </button>
      )}

      {/* 大カード＋評価セクション */}
      <div className={styles.mainCardSection}>
        <div className={styles.cardTitle}>{currentCard.title}</div>
        <div className={styles.cardContainer}>
          <div
            className={`${styles.largeCard} ${
              isFlipped ? styles.flipped : ""
            }`}
            onClick={() => setIsFlipped((f) => !f)}
          >
            <img
              src={isFlipped ? currentCard.backSrc : currentCard.src}
              alt={currentCard.title}
            />
          </div>
          {/* 回転インジケーター */}
          <div 
            className={styles.flipIndicator}
            onClick={() => setIsFlipped((f) => !f)}
          >
            <svg 
              width="40" 
              height="40" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              className={styles.flipIcon}
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            <span className={styles.flipText}>
              {isFlipped ? "表に戻す" : "裏を見る"}
            </span>
          </div>
        </div>
        <div className={styles.polaritySection}>
          <div className={styles.polarityButtons}>
            <button 
              className={`${styles.polarityBtn} ${styles.wantToGo}`}
              onClick={() => handlePolaritySelect(3)}
              disabled={isSubmitting}
            >
              行きたい
            </button>
            <button 
              className={`${styles.polarityBtn} ${styles.neutral}`}
              onClick={() => handlePolaritySelect(2)}
              disabled={isSubmitting}
            >
              どちらでもいい
            </button>
            <button 
              className={`${styles.polarityBtn} ${styles.dontWant}`}
              onClick={() => handlePolaritySelect(1)}
              disabled={isSubmitting}
            >
              行きたくない
            </button>
          </div>
        </div>
      </div>

      {/* 横スクロール可能なカード一覧 */}
      <div className={styles.cardScrollContainer}>
        <div className={styles.cardScrollWrapper}>
          {cards.map((card, index) => (
            <div
              key={card.id}
              className={`${styles.scrollCard} ${
                index === selectedIndex ? styles.scrollCardSelected : ""
              }`}
              onClick={() => {
                setSelectedIndex(index);
                setIsFlipped(false);
              }}
            >
              <img src={card.src} alt={card.title} />
              <div className={styles.scrollCardTitle}>{card.title}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 「すべて見る」モーダル */}
      <div className={styles.viewAllWrapper}>
        <button
          className={styles.viewAllBtn}
          onClick={() => setShowAll(true)}
        >
          すべて見る
        </button>
      </div>
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

      {/* マップボタン */}
      <MapButton />
    </div>
  );
}
