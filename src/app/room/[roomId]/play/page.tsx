"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  query,
  where,
  orderBy,
  getDocs,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { addAuthKey } from "../../../../../lib/firebase-auth";
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

  // カード名定義（39枚）
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

  // 初期カードプール（39枚）
  const initialCards: PlayPageCard[] = Array.from({ length: 39 }, (_, i) => {
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
  const [logVisible, setLogVisible] = useState(false); // 初期は閉じておき、再表示ボタンのみ見せる
  const [showAll, setShowAll] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scale, setScale] = useState(1);
  const submitLockRef = useRef(false);
  const [minStops, setMinStops] = useState<number>(6); // 周遊数（Firestoreから取得）
  const [showWarning, setShowWarning] = useState(false); // 警告表示フラグ
  const [lastCardPushed, setLastCardPushed] = useState(false); // 最後のカードが押されたフラグ
  const [cardPreview, setCardPreview] = useState<{ card: PlayPageCard; flipped: boolean } | null>(null); // カードプレビューモーダル

  // 画面の高さに合わせて全UIを縮小して収める
  useEffect(() => {
    const updateScale = () => {
      const h = window.innerHeight || 0;
      if (h < 720) setScale(0.85);
      else if (h < 820) setScale(0.9);
      else if (h < 900) setScale(0.95);
      else setScale(1);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Firestoreからルーム情報（minStops）を取得
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, "rooms", roomId);
    const unsub = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.minStops !== undefined) {
          setMinStops(data.minStops);
        }
      }
    });
    return () => unsub();
  }, [roomId]);

  // 最後のカードが押されて全カードが使い切られたら条件チェック
  useEffect(() => {
    if (cards.length === 0 && isInitialized && roomId && lastCardPushed) {
      // 「行きたい」カードの数をチェック
      const wantCards = logs.filter(log => log.polarity === 3).length;
      const requiredWantCards = Math.ceil(minStops / 2);
      
      if (wantCards < requiredWantCards) {
        // 条件を満たしていない場合：最後のログを戻す処理を実行
        const revertLastLog = async () => {
          if (logs.length > 0) {
            const lastLog = logs[logs.length - 1];
            if (!roomId || typeof roomId !== 'string') return;
            await deleteDoc(doc(db, "rooms", roomId, "logs", lastLog.id));
            setCards((prev) => {
              if (prev.some((c) => c.title === lastLog.card)) return prev;
              const original = initialCards.find((c) => c.title === lastLog.card);
              return original ? [...prev, original] : prev;
            });
          }
        };
        revertLastLog();
        setShowWarning(true);
        setLastCardPushed(false);
      } else {
        // 条件を満たしている場合はplay2へ遷移
        router.push(`/room/${roomId}/play2`);
      }
    }
  }, [cards.length, isInitialized, roomId, router, logs, minStops, lastCardPushed, initialCards]);

  // selectedIndex が範囲外になったら最後に合わせる
  useEffect(() => {
    if (selectedIndex >= cards.length && cards.length > 0) {
      setSelectedIndex(cards.length - 1);
    }
    // カードが減ったら必ず表に戻す
    setIsFlipped(false);
  }, [cards.length, selectedIndex]);

  // Firestore から自分の移動ログをリアルタイム監視
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string' || !userName) return;
    
    const q = query(
      collection(db, "rooms", roomId, "logs"),
      where("user", "==", userName)
    );
    
    // onSnapshotでリアルタイム監視
    const unsubscribe = onSnapshot(q, (snap) => {
      const myLogs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      
      // タイムスタンプでソート（クライアント側で実行）
      const sortedLogs = myLogs.sort((a, b) => {
        const aTime = a.timestamp?.toMillis?.() || 0;
        const bTime = b.timestamp?.toMillis?.() || 0;
        return aTime - bTime;
      });
      
      setLogs(sortedLogs);

      // ログから使用済みカードを特定して残りカードを設定
      const usedCardTitles = new Set(myLogs.map(log => log.card));
      const remainingCards = initialCards.filter(card => !usedCardTitles.has(card.title));
      
      setCards(remainingCards);
      
      if (!isInitialized) {
        setIsInitialized(true);
      }
      
      console.log(`play: ログ更新 - 残りカード数: ${remainingCards.length}, 使用済み: ${usedCardTitles.size}`);
    }, (error) => {
      console.error("play: ログ取得エラー:", error);
      if (!isInitialized) {
        setIsInitialized(true);
      }
    });
    
    return () => unsubscribe();
  }, [roomId, userName, isInitialized, initialCards]);

  const currentCard = useMemo(
    () => cards[selectedIndex] ?? null,
    [cards, selectedIndex]
  );

  // 必要な「行きたい」カード枚数を計算
  const requiredWantCards = Math.ceil(minStops / 2);
  const currentWantCards = logs.filter(log => log.polarity === 3).length;

  // カードが１枚もない or currentCard が無効なら何も描かない（ただし警告が出ている場合は表示）
  if (!currentCard && !showWarning) {
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
      await addDoc(collection(db, "rooms", roomId, "logs"), addAuthKey({
        user: userName,
        card: currentCard.title,
        polarity: selectedPolarity,
        category: categoryMapping[selectedPolarity], // データベース用の分類を追加
        timestamp: serverTimestamp(),
        message: `${userName}が「${currentCard.title}」を${polarityText}に選択`,
      }));
      // インデックスではなくIDで削除（連打や選択インデックス変化に強い）
      const removeId = currentCard.id;
      setCards((prev) => {
        const newCards = prev.filter((c) => c.id !== removeId);
        // 最後のカードが削除される場合、フラグを立てる
        if (newCards.length === 0) {
          setLastCardPushed(true);
        }
        return newCards;
      });
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

  // ログパネル内スクロール時に画面全体がスクロールしないよう制御
  const handleLogWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    const t = e.currentTarget;
    const atTop = t.scrollTop === 0;
    const atBottom = Math.abs(t.scrollHeight - t.clientHeight - t.scrollTop) < 1;
    if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // const polarityColors: Record<number, string> = {
  //   1: "#64b5f6",
  //   2: "#ccc",
  //   3: "#f48fb1",
  // };

  return (
    <div className={styles.wrapper}>
      {/* 警告モーダル */}
      {showWarning && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: '32px',
              borderRadius: '16px',
              maxWidth: '500px',
              width: '90%',
              textAlign: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{ marginBottom: '16px', fontSize: '1.5rem', color: '#dc2626' }}>
              条件を満たしていません
            </h2>
            <p style={{ marginBottom: '24px', fontSize: '1.1rem', lineHeight: '1.6' }}>
              行きたいに<strong>{requiredWantCards - currentWantCards}枚</strong>ありません！<br />
              移動ログからカードを戻し、<br />
              行きたいカードを再度選択してください。
            </p>
            <button
              onClick={() => setShowWarning(false)}
              style={{
                padding: '12px 32px',
                fontSize: '1rem',
                fontWeight: 'bold',
                backgroundColor: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* 条件表示（左上） */}
      {/* 条件表示（左上） */}
      <div
        style={{
          position: 'fixed',
          top: '12px',
          left: '12px',
          padding: '10px 14px',
          backgroundColor: '#fef3c7',
          color: '#92400e',
          border: '2px solid #f59e0b',
          borderRadius: '8px',
          fontSize: '0.8rem',
          fontWeight: 'bold',
          zIndex: 100,
          boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          lineHeight: '1.5',
          maxWidth: '200px',
        }}
      >
        <div style={{ marginBottom: '4px', fontSize: '0.85rem', color: '#78350f' }}>📋 条件</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: (currentWantCards >= requiredWantCards) ? '#065f46' : '#92400e'
          }}
        >
          <span>{(currentWantCards >= requiredWantCards) ? '✅' : '⏳'}</span>
          <span>・行きたい{requiredWantCards}枚以上</span>
        </div>
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #fbbf24', fontSize: '0.75rem' }}>
          現在: <span style={{ color: (currentWantCards >= requiredWantCards) ? '#065f46' : '#dc2626' }}>{currentWantCards}枚</span>
        </div>
      </div>

      {/* 移動ログパネル */}
      {logVisible && (
        <div
          className={styles.logPanel}
          style={{
            maxHeight: logExpanded ? "calc(100vh - 200px)" : "200px",
            overflowY: "auto",
            overflowX: "hidden",
            position: 'fixed',
            top: '1rem',
            right: '1rem',
            left: 'auto',
            padding: 0,
          }}
          onWheel={handleLogWheel}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'sticky',
              top: 0,
              background: '#fff',
              padding: '12px 12px 14px',
              margin: 0,
              zIndex: 1,
              boxShadow: '0 6px 10px rgba(0,0,0,0.04)',
            }}
          >
            <h3 style={{ margin: 0 }}>移動ログ</h3>
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
          <ul style={{ listStyle: 'none', padding: '0 12px 12px', margin: 0, background: '#fff' }}>
            {[...logs].reverse().map((l) => {
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
                <li key={l.id} style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                  {l.user}が「
                  <span 
                    style={{ 
                      color: '#2563eb', 
                      cursor: 'pointer', 
                      textDecoration: 'underline',
                      fontWeight: 600
                    }}
                    onClick={() => {
                      const card = initialCards.find(c => c.title === l.card);
                      if (card) {
                        setCardPreview({ card, flipped: false });
                      }
                    }}
                  >
                    {l.card}
                  </span>
                  」を
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
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              background: '#fff',
              padding: '12px',
              margin: 0,
              boxShadow: '0 -6px 10px rgba(0,0,0,0.04)',
            }}
          >
            <button
              className={styles.toggleLogBtn}
              onClick={() => setLogExpanded((f) => !f)}
            >
              {logExpanded ? "閉じる" : "もっと見る"}
            </button>
          </div>
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

      {/* 大カード＋評価セクション（カードがある場合のみ） */}
      {currentCard && !showWarning && (
        <>
          <div className={styles.mainCardSection}>
        <div className={styles.cardTitle}>{currentCard.title}</div>
        <div className={styles.cardContainer}>
          <div
            className={`${styles.largeCard} ${
              isFlipped ? styles.flipped : ""
            }`}
              onClick={() =>
                setCardPreview({ card: currentCard, flipped: isFlipped })
              }
          >
            <img
              src={isFlipped ? currentCard.backSrc : currentCard.src}
              alt={currentCard.title}
            />

              {/* 拡大アイコン（play2と同じ挙動でプレビューを開く） */}
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  width: 36,
                  height: 36,
                  backgroundColor: "rgba(59, 130, 246, 0.9)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 3px 10px rgba(0,0,0,0.25)",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setCardPreview({ card: currentCard, flipped: isFlipped });
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ width: 20, height: 20 }}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
              </div>
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

      {/* 条件不足警告モーダル */}
      {showWarning && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "12px",
              padding: "32px 24px",
              maxWidth: "420px",
              width: "90%",
              textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
          >
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
            <h2 style={{ marginBottom: "16px", fontSize: "1.5rem", color: "#dc2626" }}>
              条件を満たしていません
            </h2>
            <p style={{ marginBottom: "24px", fontSize: "1.1rem", lineHeight: "1.6", color: "#6b7280" }}>
              行きたいカードが{Math.ceil(minStops / 2)}枚以上必要です。<br/>
              現在: <strong>{logs.filter(log => log.polarity === 3).length}枚</strong> / 必要: <strong>{Math.ceil(minStops / 2)}枚</strong>
            </p>
            <button
              onClick={() => setShowWarning(false)}
              style={{
                padding: "12px 32px",
                fontSize: "1rem",
                fontWeight: "bold",
                backgroundColor: "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* カードプレビューモーダル */}
      {cardPreview && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
          }}
          onClick={() => setCardPreview(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "90vw",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* カード画像 */}
            <div
              style={{
                position: "relative",
                width: "auto",
                maxWidth: "400px",
                maxHeight: "50vh",
                cursor: "pointer",
              }}
              onClick={() => setCardPreview(prev => prev ? { ...prev, flipped: !prev.flipped } : null)}
            >
              <img
                src={cardPreview.flipped ? cardPreview.card.backSrc : cardPreview.card.src}
                alt={cardPreview.card.title}
                style={{
                  width: "100%",
                  height: "auto",
                  borderRadius: "12px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                }}
              />
              {/* ズームアイコン */}
              <div
                style={{
                  position: "absolute",
                  top: "16px",
                  right: "16px",
                  width: "40px",
                  height: "40px",
                  backgroundColor: "rgba(59, 130, 246, 0.9)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                  pointerEvents: "none",
                }}
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="white" 
                  strokeWidth="2.5"
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  style={{ width: "22px", height: "22px" }}
                >
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                  <line x1="11" y1="8" x2="11" y2="14"/>
                  <line x1="8" y1="11" x2="14" y2="11"/>
                </svg>
              </div>
              {/* 回転アイコン */}
              <div
                style={{
                  position: "absolute",
                  bottom: "16px",
                  right: "16px",
                  background: "rgba(255,255,255,0.9)",
                  borderRadius: "50%",
                  padding: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
              >
                <svg 
                  width="24" 
                  height="24" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="#3b82f6" 
                  strokeWidth="2"
                >
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
              </div>
            </div>
            {/* カード名 */}
            <div
              style={{
                marginTop: "16px",
                fontSize: "1.5rem",
                fontWeight: "bold",
                color: "#fff",
                textAlign: "center",
                textShadow: "0 2px 8px rgba(0,0,0,0.5)",
              }}
            >
              {cardPreview.card.title}
            </div>
          </div>
        </div>
      )}

      {/* マップボタン */}
      <MapButton />
        </>
      )}
    </div>
  );
}
