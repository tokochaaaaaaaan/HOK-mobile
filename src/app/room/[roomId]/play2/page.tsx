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
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { normalizeCategories } from "../../../../utils/normalizeCategories";

type LogEntry = { id: string; user: string; card: string; polarity: number; category?: string };
type CardInfo = { id: string; title: string; src: string; backSrc: string };

// アイコンの定義
const reasonIcons = [
  { key: "gourmet", src: "/emoji/gourmet.svg", emoji: "🍴", text: "ご当地グルメ" },
  { key: "thrill", src: "/emoji/thrill.svg", emoji: "🎢", text: "スリル" },
  { key: "experience", src: "/emoji/experience.svg", emoji: "🏃", text: "体験" },
  { key: "shopping", src: "/emoji/shopping.svg", emoji: "🛍", text: "買い物" },
  { key: "design", src: "/emoji/design.svg", emoji: "🖼", text: "建築・デザイン" },
  { key: "scenery", src: "/emoji/scenery.svg", emoji: "🏞", text: "景色" },
  { key: "time", src: "/emoji/time.svg", emoji: "⏱", text: "時間" },
  { key: "cost", src: "/emoji/cost.svg", emoji: "💰", text: "コスパ" },
  { key: "friends", src: "/emoji/friends.svg", emoji: "🤝", text: "友達と一緒に" },
  { key: "family", src: "/emoji/family.svg", emoji: "👪", text: "家族向け" },
  { key: "relax", src: "/emoji/relax.svg", emoji: "🧘", text: "リラックス" },
  { key: "other", src: "/emoji/other.svg", emoji: "❗", text: "その他" }
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
      Array.from({ length: 40 }, (_, i) => {
        const idx = i + 1;
        return {
          id: `card${idx}`,
          title: `カード${idx}`,
          src: `/pngs/USJ_${idx}_surface-1.png`,
          backSrc: `/pngs/back/USJ_${idx}_back-1.png`,
        };
      }),
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

  // リロード対応：play2Selectionsからデータを復元
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string' || !userName || isInitialized) return;

    const unsubscribe = onSnapshot(
      doc(db, "rooms", roomId, "play2Selections", userName),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log("play2: リロード復元データ:", data);
          
          if (data.want) {
            setWantSelected(new Set(data.want));
          }
          if (data.dont) {
            setDontSelected(new Set(data.dont));
          }
          if (data.reasons) {
            setReasons(data.reasons);
          }
        } else {
          console.log("play2: 新規ユーザー - 初期状態で開始");
        }
        setIsInitialized(true);
      }
    );

    return () => unsubscribe();
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
    
    // 既存の理由がアイコンのテキストと一致するかチェック
    const existingIconIndex = existingReason 
      ? reasonIcons.findIndex(icon => icon.text === existingReason)
      : -1;
    
    setReasonModal({
      isOpen: true,
      cardId,
      cardInfo,
      isFlipped: false,
      selectedIcon: existingIconIndex >= 0 ? existingIconIndex : null,
      customReason: existingIconIndex >= 0 ? "" : (existingReason || ""),
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
    const finalReason = selectedIcon !== null ? reasonIcons[selectedIcon].text : customReason.trim();
    
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

    // 既に選択済みなら解除＆理由削除
    if (selSet.has(id)) {
      setter((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setReasons((prev) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [id]: deleted, ...rest } = prev;
        return rest;
      });
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

  // 自動保存処理（選択やプラン名が変更された時）
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  
  const autoSave = useCallback(async () => {
    if (!roomId || typeof roomId !== 'string' || !userName || !isInitialized) return;
    
    try {
      const saveData = {
        user: userName,
        want: Array.from(wantSelected),
        dont: Array.from(dontSelected),
        reasons,
        planName,
        updatedAt: serverTimestamp(),
        lastUpdated: new Date(),
      };
      
      await setDoc(doc(db, "rooms", roomId, "play2Selections", userName), saveData);
      console.log("play2: 自動保存完了");
    } catch (error) {
      console.error("play2: 自動保存エラー:", error);
    }
  }, [roomId, userName, wantSelected, dontSelected, reasons, planName, isInitialized]);

  // デバウンス付き自動保存
  const debouncedAutoSave = useCallback(() => {
    setSaveTimeout(prevTimeout => {
      if (prevTimeout) {
        clearTimeout(prevTimeout);
      }
      
      return setTimeout(() => {
        autoSave();
      }, 1000); // 1秒後に保存
    });
  }, [autoSave]);

  // 選択状態やプラン名が変更された時に自動保存
  useEffect(() => {
    if (isInitialized) {
      debouncedAutoSave();
    }
  }, [wantSelected, dontSelected, reasons, planName, isInitialized, debouncedAutoSave]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
    };
  }, [saveTimeout]);

  const handleFinish = async () => {
    if (!roomId || typeof roomId !== 'string' || !userName) return;
    
    try {
      console.log("play2: Starting save with data:", {
        user: userName,
        verywant: Array.from(wantSelected),
        verydont: Array.from(dontSelected),
        reasons,
        planname: planName,
        playCategories,
      });
      
      // waiting pageで使用するcategories形式に変換（重複排除前）
      let categoriesData: any = {
        verywant: Array.from(wantSelected).map(cardId => {
          const card = allCards.find(c => c.id === cardId);
            return card ? { ...card, reason: reasons[cardId] || "" } : null;
        }).filter(Boolean),
        want: playCategories.want.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
        neutral: playCategories.neutral.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
        dont: playCategories.dont.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
        verydont: Array.from(dontSelected).map(cardId => {
          const card = allCards.find(c => c.id === cardId);
          return card ? { ...card, reason: reasons[cardId] || "" } : null;
        }).filter(Boolean),
      };
      categoriesData = normalizeCategories(categoriesData);
      
      // Firestoreに保存（ユーザー名をドキュメントIDとして使用）
      const userSelectionRef = doc(db, "rooms", roomId, "finalSelections", userName);
      await setDoc(userSelectionRef, {
        user: userName,
        userId: userName,
        userName: userName,
        categories: categoriesData,
        planname: planName,
        reasons,
        timestamp: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastUpdated: new Date(),
      });
      
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
          }}
        >
          <div
            style={{
              width: "80%",
              maxWidth: 600,
              background: "#fff",
              padding: 24,
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            }}
          >
            <p style={{ marginBottom: 16, fontSize: "1.1rem" }}>
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
                marginBottom: 24,
              }}
            >
              {planName}
            </div>

            {/* カード一覧 */}
            <div style={{ textAlign: "left", marginBottom: 24 }}>
              <h3>カード一覧</h3>
              <div style={{ marginBottom: 16 }}>
                <strong>行きたいカード</strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {Array.from(wantSelected)
                    .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                    .map((id) => {
                    const c = allCards.find((x) => x.id === id)!;
                    const reason = reasons[id];
                    const reasonIcon = reasonIcons.find(icon => icon.text === reason);
                    const displayText = reasonIcon ? `${reasonIcon.emoji} ${reason}` : reason;
                    
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
                          }}
                        />
                        {reason && (
                          <span
                            style={{
                              position: "absolute",
                              bottom: 4,
                              left: "50%",
                              transform: "translateX(-50%)",
                              backgroundColor: "rgba(0,0,0,0.7)",
                              color: "#fff",
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: "0.6rem",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: "76px",
                            }}
                            title={displayText}
                          >
                            {displayText}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <strong>行きたくないカード</strong>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 8,
                  }}
                >
                  {Array.from(dontSelected)
                    .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                    .map((id) => {
                    const c = allCards.find((x) => x.id === id)!;
                    const reason = reasons[id];
                    const reasonIcon = reasonIcons.find(icon => icon.text === reason);
                    const displayText = reasonIcon ? `${reasonIcon.emoji} ${reason}` : reason;
                    
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
                          }}
                        />
                        {reason && (
                          <span
                            style={{
                              position: "absolute",
                              bottom: 4,
                              left: "50%",
                              transform: "translateX(-50%)",
                              backgroundColor: "rgba(0,0,0,0.7)",
                              color: "#fff",
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontSize: "0.6rem",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: "76px",
                            }}
                            title={displayText}
                          >
                            {displayText}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 16 }}>
              <button
                onClick={async () => {
                  if (!roomId || typeof roomId !== 'string' || !userName) return;
                  
                  try {
                    // waiting pageで使用するcategories形式に変換（重複排除前）
                    let categoriesData: any = {
                      verywant: Array.from(wantSelected).map(cardId => {
                        const card = allCards.find(c => c.id === cardId);
                          return card ? { ...card, reason: reasons[cardId] || "" } : null;
                      }).filter(Boolean),
                      want: playCategories.want.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
                      neutral: playCategories.neutral.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
                      dont: playCategories.dont.map(cardId => allCards.find(c => c.id === cardId)).filter(Boolean),
                      verydont: Array.from(dontSelected).map(cardId => {
                        const card = allCards.find(c => c.id === cardId);
                        return card ? { ...card, reason: reasons[cardId] || "" } : null;
                      }).filter(Boolean),
                    };
                    categoriesData = normalizeCategories(categoriesData);
                    
                    // プラン名を含めて再度保存
                    const userSelectionRef = doc(db, "rooms", roomId, "finalSelections", userName);
                    await setDoc(userSelectionRef, {
                      user: userName,
                      userId: userName,
                      userName: userName,
                      
                      // 新形式（waiting pageで使用）
                      categories: categoriesData,
                      planname: planName, // プラン名はplanname
                      
                      // playからの分類（互換性のため）
                      want: playCategories.want,
                      neutral: playCategories.neutral,
                      dont: playCategories.dont,
                      
                      // play2での選択
                      verywant: Array.from(wantSelected),
                      verydont: Array.from(dontSelected),
                      reasons,
                      
                      timestamp: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                      lastUpdated: new Date(),
                    });
                    
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

      {/* Main Play2Page UI */}
      <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }}>
        <h1 style={{ textAlign: "center", marginBottom: 24 }}>
          特に行きたい・行きたくないカードを {" "}
          <strong style={{ color: "#2196f3" }}>{minStops}</strong>個選んでください
        </h1>

        {/* フィルターボタン */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <button
            onClick={() => setFilter("want")}
            style={{
              marginRight: 8,
              padding: "8px 16px",
              fontSize: "1rem",
              background: filter === "want" ? "#e91e63" : "#eee",
              color: filter === "want" ? "#fff" : "#333",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            行きたい
          </button>
          <button
            onClick={() => setFilter("dont")}
            style={{
              padding: "8px 16px",
              fontSize: "1rem",
              background: filter === "dont" ? "#03a9f4" : "#eee",
              color: filter === "dont" ? "#fff" : "#333",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            行きたくない
          </button>
        </div>

        {/* カード一覧＋ライブラリ＋終了ボタン */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 32,
          }}
        >
          {/* カード一覧 */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))",
              gap: 16,
              width: "100%",
              maxWidth: 800,
            }}
          >
            {filteredCards.map((card) => (
              <div
                key={card.id}
                onClick={() => handleFlip(card.id)}
                onDoubleClick={() => handleSelect(card.id)}
                style={{
                  border: currentSel.has(card.id)
                    ? "3px solid #ff9800"
                    : "1px solid #ccc",
                  borderRadius: 8,
                  cursor: "pointer",
                  overflow: "hidden",
                  userSelect: "none",
                }}
              >
                <img
                  src={flipped.has(card.id) ? card.backSrc : card.src}
                  alt={card.title}
                  style={{ width: "100%", display: "block" }}
                />
                <div style={{ padding: 8, textAlign: "center" }}>
                  {card.title}
                </div>
              </div>
            ))}
          </div>

          {/* ライブラリ */}
          <div
            style={{
              width: "100%",
              maxWidth: 800,
              padding: 16,
              backgroundColor: "#fafafa",
              border: "1px solid #ddd",
              borderRadius: 8,
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "1.1rem" }}>
              {filter === "want"
                ? "特に行きたいカード"
                : "特に行きたくないカード"}
            </h2>
            <p style={{ margin: "0 0 12px", fontSize: "0.9rem", color: "#666" }}>
              カードをクリックすると理由を編集できます
            </p>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                justifyContent: "center",
                overflowX: "auto",
              }}
            >
              {Array.from(currentSel)
                .sort((a, b) => parseInt(a.replace("card", ""), 10) - parseInt(b.replace("card", ""), 10))
                .map((id) => {
                const card = allCards.find((c) => c.id === id)!;
                const reason = reasons[id];
                const reasonIcon = reasonIcons.find(icon => icon.text === reason);
                const displayText = reasonIcon ? `${reasonIcon.emoji} ${reason}` : reason;
                
                return (
                  <div 
                    key={id} 
                    style={{ position: "relative", width: 80, cursor: "pointer" }}
                    onClick={() => openReasonModal(id)}
                    title="クリックして理由を編集"
                  >
                    <img
                      src={card.src}
                      alt={card.title}
                      style={{
                        width: "100%",
                        borderRadius: 4,
                        boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                      }}
                    />
                    {reason && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 4,
                          left: "50%",
                          transform: "translateX(-50%)",
                          backgroundColor: "rgba(0,0,0,0.7)",
                          color: "#fff",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: "0.6rem",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "76px",
                        }}
                        title={displayText}
                      >
                        {displayText}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 終了して次へボタン */}
          <div style={{ textAlign: "center" }}>
            <button
              onClick={handleFinish}
              style={{
                padding: "12px 24px",
                fontSize: "1rem",
                background: "#2196f3",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              終了して次へ
            </button>
          </div>
        </div>
      </div>

      {/* 理由記入ウィンドウ */}
      {reasonModal.isOpen && reasonModal.cardInfo && (
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
            zIndex: 3000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeReasonModal();
          }}
        >
          <div
            style={{
              width: "80%",
              maxWidth: 800,
              height: "80%",
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            }}
          >
            {/* ヘッダー */}
            <div
              style={{
                textAlign: "center",
                marginBottom: 24,
                fontSize: "1.2rem",
                fontWeight: "bold",
              }}
            >
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
                  paddingTop: 12,
                  paddingBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 180,
                    height: 280,
                    cursor: "pointer",
                    borderRadius: 8,
                    overflow: "hidden",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                    marginTop: 12,
                    marginBottom: 12,
                  }}
                  onClick={() =>
                    setReasonModal(prev => ({ ...prev, isFlipped: !prev.isFlipped }))
                  }
                >
                  <img
                    src={
                      reasonModal.isFlipped
                        ? reasonModal.cardInfo.backSrc
                        : reasonModal.cardInfo.src
                    }
                    alt={reasonModal.cardInfo.title}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 12,
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
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 12,
                    marginBottom: 24,
                  }}
                >
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
                      style={{
                        padding: 12,
                        border: reasonModal.selectedIcon === index ? "3px solid #2196f3" : "1px solid #ddd",
                        borderRadius: 8,
                        cursor: "pointer",
                        textAlign: "center",
                        backgroundColor: reasonModal.selectedIcon === index ? "#e3f2fd" : "#fff",
                        transition: "all 0.2s ease",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 60,
                        
                      }}
                    >
                      <img src={icon.src} alt={icon.text} width={36} height={36} style={{ display: 'block' }} />
                    </div>
                  ))}
                </div>

                {/* テキストボックス */}
                <textarea
                  value={reasonModal.customReason}
                  onChange={(e) =>
                    setReasonModal(prev => ({ 
                      ...prev, 
                      customReason: e.target.value,
                      selectedIcon: null 
                    }))
                  }
                  placeholder={
                    reasonModal.selectedIcon !== null 
                      ? reasonIcons[reasonModal.selectedIcon].text 
                      : "理由を記入して下さい"
                  }
                  style={{
                    width: "100%",
                    height: 80,
                    padding: 12,
                    fontSize: "1rem",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    resize: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            {/* フッター：ボタン */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 16,
                marginTop: 24,
              }}
            >
              <button
                onClick={confirmReason}
                style={{
                  padding: "12px 24px",
                  fontSize: "1rem",
                  backgroundColor: "#2196f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                決定
              </button>
              <button
                onClick={closeReasonModal}
                style={{
                  padding: "12px 24px",
                  fontSize: "1rem",
                  backgroundColor: "#666",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
