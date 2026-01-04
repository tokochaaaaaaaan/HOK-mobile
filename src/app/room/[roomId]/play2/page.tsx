"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  setDoc,
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { normalizeCategories } from "../../../../utils/normalizeCategories";
import MapButton from "@/components/MapButton";
import { cards } from "@/data/cards";
import styles from "./page.module.css";

type LogEntry = { id: string; user: string; card: string; polarity: number; category?: string };
type CardInfo = { id: string; title: string; src: string; backSrc: string };

// アイコンの定義
const reasonIcons = [
  { key: "gourmet", src: "/emoji/gourmet.svg", emoji: "🍽", text: "食", fullText: "食事" },
  { key: "thrill", src: "/emoji/thrill.svg", emoji: "🎢", text: "激", fullText: "スリル" },
  { key: "experience", src: "/emoji/experience.svg", emoji: "🎯", text: "体", fullText: "体験" },
  { key: "shopping", src: "/emoji/shopping.svg", emoji: "🛍", text: "買", fullText: "買い物" },
  { key: "design", src: "/emoji/design.svg", emoji: "🏛", text: "建築", fullText: "建築・デザイン" },
  { key: "scenery", src: "/emoji/scenery.svg", emoji: "🌅", text: "景", fullText: "景色" },
  { key: "time", src: "/emoji/time.svg", emoji: "⏰", text: "時", fullText: "時間" },
  { key: "cost", src: "/emoji/cost.svg", emoji: "💰", text: "¥", fullText: "コスパ" },
  { key: "friends", src: "/emoji/friends.svg", emoji: "👥", text: "友", fullText: "友達と一緒に" },
  { key: "family", src: "/emoji/family.svg", emoji: "👨‍👩‍👧‍👦", text: "家", fullText: "家族向け" },
  { key: "relax", src: "/emoji/relax.svg", emoji: "🧘", text: "休", fullText: "リラックス" },
  { key: "other", src: "/emoji/other.svg", emoji: "❗", text: "他", fullText: "その他" }
];

export default function Play2Page() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  // (0) ホスト設定の最小訪問数を取得 (minStops)
  const [minStops, setMinStops] = useState<number>(0); // renamed from maxStops
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, "rooms", roomId);
    return onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        setMinStops((snap.data().minStops as number) || 0); // renamed field
      }
    });
  }, [roomId]);

  // (1) 全カード情報を準備
  const allCards: CardInfo[] = useMemo(
    () =>
      cards.map((card) => ({
        id: `card${card.id}`,
        title: card.title,
        src: card.frontSrc,
        backSrc: card.backSrc,
      })),
    []
  );

  // (2) play1 のログをリアルタイム購読 + playからのカテゴリ分類を取得
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [playCategories, setPlayCategories] = useState<{want: string[], neutral: string[], dont: string[]}>({
    want: [],
    neutral: [],
    dont: []
  });
  
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const q = query(
      collection(db, "rooms", roomId, "logs"),
      where("user", "==", userName)
    );
    return onSnapshot(q, (snap) => {
      const userLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LogEntry));
      setLogs(userLogs);
      
      // playからのカテゴリ分類を取得
      const categories = {
        want: [] as string[],
        neutral: [] as string[],
        dont: [] as string[]
      };
      
      userLogs.forEach(log => {
        const card = allCards.find(c => c.title === log.card);
        if (card) {
          // categoryフィールドがある場合はそれを使用、なければpolarityから判定
          const category = log.category || (log.polarity === 3 ? 'want' : log.polarity === 1 ? 'dont' : 'neutral');
          if (category === 'want') categories.want.push(card.id);
          else if (category === 'neutral') categories.neutral.push(card.id);
          else if (category === 'dont') categories.dont.push(card.id);
        }
      });
      
      setPlayCategories(categories);
      console.log("play2: Loaded play categories:", categories);
    });
  }, [roomId, userName, allCards]);

  // (3) 「行きたい／行きたくない」フィルター
  const [filter, setFilter] = useState<"want" | "dont">("want");

  // (4) カード表裏フリップ管理
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const handleFlip = (id: string) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      if (prev.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // (5) 選択セット＆理由管理
  const [wantSelected, setWantSelected] = useState<Set<string>>(new Set());
  const [dontSelected, setDontSelected] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [showAllModal, setShowAllModal] = useState(false);
  const [showWarning, setShowWarning] = useState(false); // 警告モーダル表示フラグ
  const [warningMessage, setWarningMessage] = useState<string>(""); // 警告メッセージ

  // リロード対応：finalSelectionsからデータを復元（初回のみ）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string' || !userName || isInitialized) return;

    getDoc(doc(db, "rooms", roomId, "finalSelections", userName))
      .then((docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log("play2: リロード復元データ:", data);
          
          // veryWant/veryDontからwant/dontを復元
          if (data.categories?.veryWant) {
            setWantSelected(new Set(data.categories.veryWant.map((c: any) => c.id || c)));
          }
          if (data.categories?.veryDont) {
            setDontSelected(new Set(data.categories.veryDont.map((c: any) => c.id || c)));
          }
          if (data.reasons) {
            setReasons(data.reasons);
          }
        } else {
          console.log("play2: 新規ユーザー - 初期状態で開始");
        }
        setIsInitialized(true);
      })
      .catch((error) => {
        console.error("play2: データ復元エラー:", error);
        setIsInitialized(true);
      });
  }, [roomId, userName, isInitialized]);

  // 理由記入ウィンドウの状態管理
  const [reasonModal, setReasonModal] = useState<{
    isOpen: boolean;
    cardId: string;
    cardInfo: CardInfo | null;
    isFlipped: boolean;
    selectedIcon: number | null;
    customReason: string;
  }>({
    isOpen: false,
    cardId: "",
    cardInfo: null,
    isFlipped: false,
    selectedIcon: null,
    customReason: "",
  });

  const openReasonModal = (cardId: string) => {
    const cardInfo = allCards.find(c => c.id === cardId) || null;
    const existingReason = reasons[cardId];
    
    let selectedIcon: number | null = null;
    let customReason = "";
    
    if (existingReason) {
      // 既存の理由を解析
      // "アイコンのfullText:カスタムテキスト" の形式かチェック
      const colonIndex = existingReason.indexOf(':');
      
      if (colonIndex !== -1) {
        // コロンが含まれている場合、前半がアイコンのfullText、後半がカスタムテキスト
        const iconPart = existingReason.substring(0, colonIndex);
        const customPart = existingReason.substring(colonIndex + 1);
        
        const iconIndex = reasonIcons.findIndex(icon => icon.fullText === iconPart);
        if (iconIndex >= 0) {
          selectedIcon = iconIndex;
          customReason = customPart;
        } else {
          // アイコンが見つからない場合は全体をカスタムテキストとして扱う
          customReason = existingReason;
        }
      } else {
        // コロンがない場合、アイコンのfullTextと一致するかチェック
        const iconIndex = reasonIcons.findIndex(icon => icon.fullText === existingReason);
        if (iconIndex >= 0) {
          selectedIcon = iconIndex;
          customReason = "";
        } else {
          // アイコンでもない場合はカスタムテキストとして扱う
          customReason = existingReason;
        }
      }
    }
    
    setReasonModal({
      isOpen: true,
      cardId,
      cardInfo,
      isFlipped: false,
      selectedIcon,
      customReason,
    });
  };

  const closeReasonModal = () => {
    setReasonModal({
      isOpen: false,
      cardId: "",
      cardInfo: null,
      isFlipped: false,
      selectedIcon: null,
      customReason: "",
    });
  };

  const confirmReason = () => {
    const { cardId, selectedIcon, customReason } = reasonModal;
    
    let finalReason = "";
    
    if (selectedIcon !== null) {
      // アイコンが選択されている場合
      const iconText = reasonIcons[selectedIcon].fullText;
      const customText = customReason.trim();
      
      if (customText) {
        // カスタムテキストがある場合: アイコンのfullText + カスタムテキスト
        finalReason = `${iconText}:${customText}`;
      } else {
        // カスタムテキストがない場合: アイコンのfullTextのみ
        finalReason = iconText;
      }
    } else {
      // アイコンが選択されていない場合: カスタムテキストのみ
      finalReason = customReason.trim();
    }
    
    if (!finalReason) {
      alert("理由を選択または入力してください");
      return;
    }

    setReasons(prev => ({ ...prev, [cardId]: finalReason }));
    
    const isWant = filter === "want";
    const setter = isWant ? setWantSelected : setDontSelected;
    setter(prev => {
      const next = new Set(prev);
      next.add(cardId);
      return next;
    });

    closeReasonModal();
  };

  const handleSelect = (id: string) => {
    const isWant = filter === "want";
    const selSet = isWant ? wantSelected : dontSelected;
    const setter = isWant ? setWantSelected : setDontSelected;

    // 既に選択済みなら理由編集モーダルを開く（解除しない）
    if (selSet.has(id)) {
      openReasonModal(id);
      return;
    }
    // 上限チェック：特に行きたい・特に行きたくないはminStops枚まで
    if (selSet.size >= minStops) {
      alert(`${filter === "want" ? "特に行きたい" : "特に行きたくない"}カードは最大${minStops}枚までです`);
      return;
    }
    // 選択可能なら理由記入ウィンドウを開く（minStops未満ならOK）
    if (selSet.size < minStops) {
      openReasonModal(id);
    } else {
      alert(`選べる上限 (${minStops}) に達しています`);
    }
  };

  // (6) フィルタ済みカードリストとオーバーレイ制御
  const filteredCards = useMemo(() => {
    const targetPol = filter === "want" ? 3 : 1;
    const cards = logs
      .filter((l) => l.polarity === targetPol)
      .map((l) => allCards.find((c) => c.title === l.card)!)
      .filter(Boolean);
    // 数字の小さい順（card1, card2, ...）で並べる
    const num = (id: string) => parseInt(id.replace("card", ""), 10);
    return cards.sort((a, b) => num(a.id) - num(b.id));
  }, [logs, filter, allCards]);

  // (7) 終了処理とオーバーレイ制御
  const [showOverlay, setShowOverlay] = useState(false);
  const [planName, setPlanName] = useState("");

  // モーダルが開いている時は背景のスクロールを防ぐ
  useEffect(() => {
    if (showOverlay) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [showOverlay]);

  const handleFinish = async () => {
    if (!roomId || typeof roomId !== 'string' || !userName) return;
    
    // 条件チェック
    const veryWantCount = wantSelected.size;
    const veryDontCount = dontSelected.size;
    const requiredVeryWant = Math.ceil(minStops / 2);

    // 1. 「特に行きたい」の下限チェック
    if (veryWantCount < requiredVeryWant) {
      setWarningMessage(`特に行きたいカードが${requiredVeryWant - veryWantCount}枚足りません！\n特に行きたいに${requiredVeryWant}枚以上必要です。`);
      setShowWarning(true);
      return;
    }
    
    try {
      console.log("play2: Starting save with data:", {
        user: userName,
        verywant: Array.from(wantSelected),
        verydont: Array.from(dontSelected),
        reasons,
        planname: planName,
        playCategories,
      });
      
      // 統一フォーマット: waiting pageと同じcategories形式
      let categoriesData: any = {
        veryWant: Array.from(wantSelected).map(cardId => {
          const card = allCards.find(c => c.id === cardId);
            return card ? { ...card, reason: reasons[cardId] || "" } : null;
        }).filter(Boolean),
        want: playCategories.want.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
        neutral: playCategories.neutral.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
        dont: playCategories.dont.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
        veryDont: Array.from(dontSelected).map(cardId => {
          const card = allCards.find(c => c.id === cardId);
          return card ? { ...card, reason: reasons[cardId] || "" } : null;
        }).filter(Boolean),
      };
      categoriesData = normalizeCategories(categoriesData);
      
      // 実験データ保持用の旧形式（verywant/verydont）も保存
      const legacyData = {
        verywant: categoriesData.veryWant,
        verydont: categoriesData.veryDont,
      };
      
      // Firestoreに保存（merge: trueで既存データを保持）
      const userSelectionRef = doc(db, "rooms", roomId, "finalSelections", userName);
      await setDoc(userSelectionRef, {
        user: userName,
        userId: userName,
        userName: userName,
        categories: categoriesData,  // 統一フォーマット（veryWant/veryDont）
        ...legacyData,  // 旧形式も保存（実験データ用）
        planname: planName,
        planName: planName,  // 両方のフィールド名を保存
        reasons,
        timestamp: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastUpdated: new Date(),
      }, { merge: true });
      
      console.log("play2: Successfully saved finalSelection with planname:", planName);
      console.log("play2: Categories data:", categoriesData);
      
      // 保存完了後にオーバーレイを表示
      setShowOverlay(true);
    } catch (error) {
      console.error("play2: Error saving finalSelection:", error);
      alert("保存中にエラーが発生しました");
    }
  };

  const currentSel = filter === "want" ? wantSelected : dontSelected;

  return (
    <>
      {/* Whiteboard Overlay */}
      {showOverlay && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            overflow: "hidden",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowOverlay(false);
            }
          }}
        >
          <div
            style={{
              width: "80%",
              maxWidth: 600,
              maxHeight: "90vh",
              background: "#fff",
              padding: 24,
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ marginBottom: 16, fontSize: "1.1rem", flexShrink: 0 }}>
              最後にこのカードを選んだ理由が<br />
              相手に伝わるようにプラン名を考えてください
            </p>
            <input
              type="text"
              placeholder="プラン名を入力"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              style={{
                width: "100%",
                padding: 8,
                fontSize: "1rem",
                boxSizing: "border-box",
                marginBottom: 16,
                background: "#fff",
                border: "2px solid #e5e7eb",
                borderRadius: 8,
                boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
                outline: "none",
                flexShrink: 0,
              }}
              onFocus={(e) => {
                e.currentTarget.style.border = "2px solid #60a5fa";
                e.currentTarget.style.boxShadow = "0 10px 28px rgba(99,102,241,0.18)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.border = "2px solid #e5e7eb";
                e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,0,0,0.08)";
              }}
            />
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: "bold",
                textAlign: "center",
                marginBottom: 16,
                flexShrink: 0,
              }}
            >
              {planName}
            </div>

            {/* カード一覧 */}
            <div 
              style={{ 
                textAlign: "left", 
                flex: 1, 
                minHeight: 0, 
                overflowY: "auto",
                marginBottom: 16,
              }}
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
            >
              <h3 style={{ marginBottom: 20, textAlign: "center", fontSize: "1.2rem" }}>選択したカード一覧</h3>
              
              {/* 特に行きたいカード */}
              <div style={{ marginBottom: 24 }}>
                <strong style={{ 
                  fontSize: "1.1rem", 
                  color: "#ef4444",
                  display: "block",
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "2px solid #ef4444"
                }}>
                  特に行きたいカード
                </strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {Array.from(wantSelected).length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    Array.from(wantSelected)
                      .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                      .map((id) => {
                      const c = allCards.find((x) => x.id === id)!;
                      const reason = reasons[id];
                      
                      // 理由を解析してアイコンとテキストを分離
                      let displayEmoji = "";
                      let displayText = reason || "";
                      
                      if (reason) {
                        const colonIndex = reason.indexOf(':');
                        if (colonIndex !== -1) {
                          const iconPart = reason.substring(0, colonIndex);
                          const customPart = reason.substring(colonIndex + 1);
                          const reasonIcon = reasonIcons.find(icon => icon.fullText === iconPart);
                          
                          if (reasonIcon) {
                            displayEmoji = reasonIcon.emoji;
                            displayText = customPart;
                          } else {
                            displayText = reason;
                          }
                        } else {
                          const reasonIcon = reasonIcons.find(icon => icon.fullText === reason);
                          if (reasonIcon) {
                            displayEmoji = reasonIcon.emoji;
                            displayText = reasonIcon.fullText;
                          } else {
                            displayText = reason;
                          }
                        }
                      }
                      
                      return (
                        <div
                          key={id}
                          style={{ position: "relative", width: 80 }}
                        >
                          <img
                            src={c.src}
                            alt={c.title}
                            style={{
                              width: "100%",
                              borderRadius: 4,
                              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                              border: "2px solid #ef4444",
                            }}
                          />
                          {reason && (
                            <div
                              style={{
                                position: "absolute",
                                bottom: 4,
                                left: "50%",
                                transform: "translateX(-50%)",
                                backgroundColor: "rgba(0,0,0,0.85)",
                                color: "#fff",
                                padding: "3px 6px",
                                borderRadius: 4,
                                fontSize: "0.65rem",
                                whiteSpace: "nowrap",
                                maxWidth: "76px",
                                display: "flex",
                                alignItems: "center",
                                gap: "2px",
                              }}
                              title={displayText}
                            >
                              {displayEmoji && <span style={{ fontSize: "0.8rem" }}>{displayEmoji}</span>}
                              <span style={{ 
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}>
                                {displayText}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* 行きたいカード（特に行きたいカードを除く） */}
              <div style={{ marginBottom: 24 }}>
                <strong style={{ 
                  fontSize: "1.1rem", 
                  color: "#ec4899",
                  display: "block",
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "2px solid #ec4899"
                }}>
                  行きたいカード
                </strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {(() => {
                    const wantCards = playCategories.want.filter(id => !wantSelected.has(id));
                    return wantCards.length === 0 ? (
                      <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                    ) : (
                      wantCards
                        .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                        .map((id) => {
                          const c = allCards.find((x) => x.id === id)!;
                          return (
                            <div key={id} style={{ position: "relative", width: 80 }}>
                              <img
                                src={c.src}
                                alt={c.title}
                                style={{
                                  width: "100%",
                                  borderRadius: 4,
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                                  border: "2px solid #ec4899",
                                }}
                              />
                            </div>
                          );
                        })
                    );
                  })()}
                </div>
              </div>

              {/* どちらでもいいカード */}
              <div style={{ marginBottom: 24 }}>
                <strong style={{ 
                  fontSize: "1.1rem", 
                  color: "#9ca3af",
                  display: "block",
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "2px solid #9ca3af"
                }}>
                  どちらでもいいカード
                </strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {(() => {
                    const neutralCards = playCategories.neutral;
                    return neutralCards.length === 0 ? (
                      <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                    ) : (
                      neutralCards
                        .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                        .map((id) => {
                          const c = allCards.find((x) => x.id === id)!;
                          return (
                            <div key={id} style={{ position: "relative", width: 80 }}>
                              <img
                                src={c.src}
                                alt={c.title}
                                style={{
                                  width: "100%",
                                  borderRadius: 4,
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                                  border: "2px solid #9ca3af",
                                }}
                              />
                            </div>
                          );
                        })
                    );
                  })()}
                </div>
              </div>

              {/* 行きたくないカード（特に行きたくないカードを除く） */}
              <div style={{ marginBottom: 24 }}>
                <strong style={{ 
                  fontSize: "1.1rem", 
                  color: "#06b6d4",
                  display: "block",
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "2px solid #06b6d4"
                }}>
                  行きたくないカード
                </strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {(() => {
                    const dontCards = playCategories.dont.filter(id => !dontSelected.has(id));
                    return dontCards.length === 0 ? (
                      <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                    ) : (
                      dontCards
                        .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                        .map((id) => {
                          const c = allCards.find((x) => x.id === id)!;
                          return (
                            <div key={id} style={{ position: "relative", width: 80 }}>
                              <img
                                src={c.src}
                                alt={c.title}
                                style={{
                                  width: "100%",
                                  borderRadius: 4,
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                                  border: "2px solid #06b6d4",
                                }}
                              />
                            </div>
                          );
                        })
                    );
                  })()}
                </div>
              </div>

              {/* 特に行きたくないカード */}
              <div>
                <strong style={{ 
                  fontSize: "1.1rem", 
                  color: "#3b82f6",
                  display: "block",
                  marginBottom: 12,
                  paddingBottom: 8,
                  borderBottom: "2px solid #3b82f6"
                }}>
                  特に行きたくないカード
                </strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {Array.from(dontSelected).length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    Array.from(dontSelected)
                      .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                      .map((id) => {
                      const c = allCards.find((x) => x.id === id)!;
                      const reason = reasons[id];
                      
                      // 理由を解析してアイコンとテキストを分離
                      let displayEmoji = "";
                      let displayText = reason || "";
                      
                      if (reason) {
                        const colonIndex = reason.indexOf(':');
                        if (colonIndex !== -1) {
                          const iconPart = reason.substring(0, colonIndex);
                          const customPart = reason.substring(colonIndex + 1);
                          const reasonIcon = reasonIcons.find(icon => icon.fullText === iconPart);
                          
                          if (reasonIcon) {
                            displayEmoji = reasonIcon.emoji;
                            displayText = customPart;
                          } else {
                            displayText = reason;
                          }
                        } else {
                          const reasonIcon = reasonIcons.find(icon => icon.fullText === reason);
                          if (reasonIcon) {
                            displayEmoji = reasonIcon.emoji;
                            displayText = reasonIcon.fullText;
                          } else {
                            displayText = reason;
                          }
                        }
                      }
                      
                      return (
                        <div
                          key={id}
                          style={{ position: "relative", width: 80 }}
                        >
                          <img
                            src={c.src}
                            alt={c.title}
                            style={{
                              width: "100%",
                              borderRadius: 4,
                              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                              border: "2px solid #3b82f6",
                            }}
                          />
                          {reason && (
                            <div
                              style={{
                                position: "absolute",
                                bottom: 4,
                                left: "50%",
                                transform: "translateX(-50%)",
                                backgroundColor: "rgba(0,0,0,0.85)",
                                color: "#fff",
                                padding: "3px 6px",
                                borderRadius: 4,
                                fontSize: "0.65rem",
                                whiteSpace: "nowrap",
                                maxWidth: "76px",
                                display: "flex",
                                alignItems: "center",
                                gap: "2px",
                              }}
                              title={displayText}
                            >
                              {displayEmoji && <span style={{ fontSize: "0.8rem" }}>{displayEmoji}</span>}
                              <span style={{ 
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}>
                                {displayText}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 16, flexShrink: 0 }}>
              <button
                onClick={async () => {
                  if (!roomId || typeof roomId !== 'string' || !userName) return;
                  
                  try {
                    // 統一フォーマット: waiting pageと同じcategories形式
                    let categoriesData: any = {
                      veryWant: Array.from(wantSelected).map(cardId => {
                        const card = allCards.find(c => c.id === cardId);
                          return card ? { ...card, reason: reasons[cardId] || "" } : null;
                      }).filter(Boolean),
                      want: playCategories.want.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
                      neutral: playCategories.neutral.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
                      dont: playCategories.dont.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
                      veryDont: Array.from(dontSelected).map(cardId => {
                        const card = allCards.find(c => c.id === cardId);
                        return card ? { ...card, reason: reasons[cardId] || "" } : null;
                      }).filter(Boolean),
                    };
                    console.log("play2: Before normalization:", JSON.stringify(categoriesData, null, 2));
                    categoriesData = normalizeCategories(categoriesData);
                    console.log("play2: After normalization:", JSON.stringify(categoriesData, null, 2));
                    
                    // 実験データ保持用の旧形式
                    const legacyPlayData = {
                      verywant: categoriesData.veryWant,
                      verydont: categoriesData.veryDont,
                      want: playCategories.want,
                      neutral: playCategories.neutral,
                      dont: playCategories.dont,
                    };
                    
                    // プラン名を含めて再度保存（merge: trueで既存データを保持）
                    const userSelectionRef = doc(db, "rooms", roomId, "finalSelections", userName);
                    await setDoc(userSelectionRef, {
                      user: userName,
                      userId: userName,
                      userName: userName,
                      
                      // 統一フォーマット（veryWant/veryDont）
                      categories: categoriesData,
                      planname: planName,
                      planName: planName,  // 両方のフィールド名を保存
                      
                      // 実験データ用の旧形式も保存
                      ...legacyPlayData,
                      reasons,
                      
                      timestamp: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                      lastUpdated: new Date(),
                    }, { merge: true });
                    
                    console.log("play2: Final save completed with planname:", planName);
                    console.log("play2: Final categories data:", categoriesData);
                    router.push(`/room/${roomId}/waiting`);
                  } catch (error) {
                    console.error("play2: Error saving final data:", error);
                    alert("保存中にエラーが発生しました");
                  }
                }}
                disabled={!planName.trim()}
                style={{
                  padding: "8px 16px",
                  fontSize: "1rem",
                  background: planName.trim() ? "#28a745" : "#ccc",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: planName.trim() ? "pointer" : "not-allowed",
                }}
              >
                次に進む
              </button>
              <button
                onClick={() => setShowOverlay(false)}
                style={{
                  padding: "8px 16px",
                  fontSize: "1rem",
                  background: "#ccc",
                  color: "#333",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                カード選択に戻る
              </button>
            </div>
          </div>
        </div>
      )}

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
            <p style={{ marginBottom: '24px', fontSize: '1.1rem', lineHeight: '1.6', whiteSpace: 'pre-line' }}>
              {warningMessage}
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
        <div>・特に行きたい{Math.ceil(minStops / 2)}枚以上</div>
        <div>・各{minStops}枚まで</div>
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #fbbf24', fontSize: '0.75rem' }}>
          現在: {wantSelected.size}枚 / {dontSelected.size}枚
        </div>
      </div>

      {/* Main Play2Page UI */}
      <div className={styles.container}>
        <h1 className={styles.title}>
          特に行きたい・行きたくないカードを {" "}
          <strong style={{ color: "#2196f3" }}>{minStops}</strong>個選んでください
        </h1>

        {/* フィルターボタン */}
        <div className={styles.filterButtons}>
          <button
            onClick={() => setFilter("want")}
            className={`${styles.filterButton} ${filter === "want" ? styles.active : ""}`}
            style={{
              backgroundColor: filter === "want" ? "#e91e63" : undefined,
              borderColor: filter === "want" ? "#e91e63" : undefined,
            }}
          >
            行きたい
          </button>
          <button
            onClick={() => setFilter("dont")}
            className={`${styles.filterButton} ${filter === "dont" ? styles.active : ""}`}
            style={{
              backgroundColor: filter === "dont" ? "#03a9f4" : undefined,
              borderColor: filter === "dont" ? "#03a9f4" : undefined,
            }}
          >
            行きたくない
          </button>
        </div>

        {/* カード一覧＋ライブラリ＋終了ボタン */}
        <div className={styles.cardArea}>
          {/* カード一覧 */}
          <div className={styles.cardListContainer}>
            <div className={styles.scrollWrapper}>
              <div className={styles.cardList}>
                {filteredCards.map((card) => (
                  <div
                    key={card.id}
                    onClick={() => handleSelect(card.id)}
                    className={styles.card}
                    style={{
                      borderColor: currentSel.has(card.id) ? "#ff9800" : "#ccc",
                      borderWidth: currentSel.has(card.id) ? "3px" : "1px",
                    }}
                  >
                    <img
                      src={card.src}
                      alt={card.title}
                      style={{ width: "100%", display: "block" }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 全て見るボタン */}
            <button
              onClick={() => setShowAllModal(true)}
              className={styles.viewAllButton}
            >
              すべて見る
            </button>
          </div>

          {/* ライブラリ */}
          <div className={styles.librarySection}>
            <h2 className={styles.libraryTitle}>
              {filter === "want"
                ? "特に行きたいカード"
                : "特に行きたくないカード"}
            </h2>
            <div className={styles.libraryScrollWrapper}>
              <div className={styles.libraryList}>
                {Array.from(currentSel)
                  .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                  .map((id) => {
                  const card = allCards.find((c) => c.id === id)!;
                  const reason = reasons[id];
                  
                  // 理由を解析してアイコンとテキストを分離
                  let displayEmoji = "";
                  let displayText = reason || "";
                  
                  if (reason) {
                    const colonIndex = reason.indexOf(':');
                    if (colonIndex !== -1) {
                      // "アイコンのfullText:カスタムテキスト" の形式
                      const iconPart = reason.substring(0, colonIndex);
                      const customPart = reason.substring(colonIndex + 1);
                      const reasonIcon = reasonIcons.find(icon => icon.fullText === iconPart);
                      
                      if (reasonIcon) {
                        displayEmoji = reasonIcon.emoji;
                        displayText = customPart;
                      } else {
                        // アイコンが見つからない場合は全体を表示
                        displayText = reason;
                      }
                    } else {
                      // コロンがない場合、アイコンのfullTextと一致するかチェック
                      const reasonIcon = reasonIcons.find(icon => icon.fullText === reason);
                      if (reasonIcon) {
                        displayEmoji = reasonIcon.emoji;
                        displayText = reasonIcon.fullText; // fullTextを表示（短縮版ではなく）
                      } else {
                        displayText = reason;
                      }
                    }
                  }
                  
                  return (
                    <div 
                      key={id} 
                      className={styles.libraryCard}
                      onClick={() => openReasonModal(id)}
                      title="クリックして理由を編集"
                    >
                      <img
                        src={card.src}
                        alt={card.title}
                        style={{ width: "100%", display: "block" }}
                      />
                      {reason && (
                        <div className={styles.reasonDisplay}>
                          {displayEmoji && <span className={styles.reasonEmoji}>{displayEmoji}</span>}
                          <span className={styles.reasonText}>
                            {displayText}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 終了して次へボタン */}
          <button
            onClick={handleFinish}
            className={styles.nextButton}
          >
            終了して次へ
          </button>
        </div>
      </div>

      {/* 全て見るモーダル */}
      {showAllModal && (
        <div className={styles.modalOverlay} onClick={() => setShowAllModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: "1.5rem", fontSize: "1.5rem", fontWeight: "bold", textAlign: "center" }}>
              {filter === "want" ? "行きたいカード一覧" : "行きたくないカード一覧"}
            </h2>
            <div className={styles.allCardsGrid}>
              {filteredCards.map((card) => (
                <div
                  key={card.id}
                  onClick={() => {
                    handleSelect(card.id);
                    setShowAllModal(false);
                  }}
                  style={{
                    cursor: "pointer",
                    textAlign: "center",
                    border: currentSel.has(card.id) ? "3px solid #ff9800" : "1px solid #ccc",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "#fff",
                  }}
                >
                  <img
                    src={card.src}
                    alt={card.title}
                    style={{ width: "100%", display: "block" }}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowAllModal(false)}
              className={`${styles.button} ${styles.buttonClose}`}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 理由記入ウィンドウ */}
      {reasonModal.isOpen && reasonModal.cardInfo && (
        <div
          className={styles.modalOverlay}
          style={{ zIndex: 3000 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeReasonModal();
          }}
        >
          <div className={`${styles.modal} ${styles.reasonModal}`}>
            {/* ヘッダー */}
            <div className={styles.reasonModalTitle}>
              このカードを選んだ理由を選択・入力してください
            </div>

            {/* メインコンテンツ */}
            <div
              style={{
                flex: 1,
                display: "flex",
                gap: 24,
              }}
            >
              {/* 左側：カード表示 */}
              <div
                style={{
                  flex: "0 0 240px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div className={styles.cardPreview}>
                  <div
                    className={`${styles.cardPreviewInner} ${reasonModal.isFlipped ? styles.flipped : ""}`}
                    onClick={() =>
                      setReasonModal(prev => ({ ...prev, isFlipped: !prev.isFlipped }))
                    }
                  >
                    <div className={styles.cardFace}>
                      <img
                        src={reasonModal.cardInfo.src}
                        alt={reasonModal.cardInfo.title}
                      />
                    </div>
                    <div className={`${styles.cardFace} ${styles.cardBack}`}>
                      <img
                        src={reasonModal.cardInfo.backSrc}
                        alt={reasonModal.cardInfo.title}
                      />
                    </div>
                    {/* 回転インジケーター */}
                    <div className={styles.flipIndicator}>
                      <svg 
                        className={styles.rotateIcon}
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="#3b82f6" 
                        strokeWidth="2.5"
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      >
                        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                      </svg>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "1rem",
                    fontWeight: "bold",
                    textAlign: "center",
                  }}
                >
                  {reasonModal.cardInfo.title}
                </div>
              </div>

              {/* 右側：アイコン選択 */}
              <div style={{ flex: 1 }}>
                <div className={styles.iconSection}>
                  <div className={styles.iconSectionTitle}>理由を選択</div>
                  <div className={styles.iconGrid}>
                    {reasonIcons.map((icon, index) => (
                      <div
                        key={index}
                        onClick={() => {
                          setReasonModal(prev => ({ 
                            ...prev, 
                            selectedIcon: index,
                            customReason: ""
                          }));
                        }}
                        className={`${styles.iconButton} ${reasonModal.selectedIcon === index ? styles.selected : ""}`}
                        title={icon.fullText}
                      >
                        <div className={styles.iconEmoji}>{icon.emoji}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* テキストボックス */}
                <textarea
                  value={reasonModal.customReason}
                  onChange={(e) =>
                    setReasonModal(prev => ({ 
                      ...prev, 
                      customReason: e.target.value
                    }))
                  }
                  placeholder={
                    reasonModal.selectedIcon !== null 
                      ? reasonIcons[reasonModal.selectedIcon].fullText 
                      : "理由を記入して下さい"
                  }
                  className={styles.textarea}
                />
              </div>
            </div>

            {/* フッター：ボタン */}
            <div className={styles.modalButtons}>
              <button
                onClick={confirmReason}
                className={`${styles.button} ${styles.buttonConfirm}`}
              >
                決定
              </button>
              <button
                onClick={closeReasonModal}
                className={`${styles.button} ${styles.buttonCancel}`}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      <MapButton />
    </>
  );
}
