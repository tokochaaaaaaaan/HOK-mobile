"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  collection,
  query,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";

// ============================================================
// waiting/page.tsx – クリック移動＋理由モーダル＆確認ウィンドウ 完全版
// 仕様：
//  1) カードをクリック → ピック状態
//     移動先エリアにカーソルを合わせると枠が強調
//     エリア内をクリック → 配置完了
//  2) 「特に行きたい / 特に行きたくない」をクリックすると play2 同様に理由モーダルを開く
//     モーダルの「戻る」で元のエリアへ戻す
//  3) 特に〜から他エリアへ移動する場合、理由を消去する確認ウィンドウを表示
//     OKなら理由をクリアして移動
//  4) 既存のページ遷移等はそのまま（このファイルでは触らない）
// ============================================================

type CategoryType = "veryWant" | "want" | "neutral" | "dont" | "veryDont";

type CardInfo = {
  id: string;
  title: string;
  src: string;     // 表面
  backSrc: string; // 裏面
};

type CardWithReason = CardInfo & {
  reason?: string; // 特に〜のときのみ
};

type Categories = {
  veryWant: CardWithReason[];
  want: CardWithReason[];
  neutral: CardWithReason[];
  dont: CardWithReason[];
  veryDont: CardWithReason[];
};

const CATEGORY_LABEL: Record<CategoryType, string> = {
  veryWant: "特に行きたい",
  want: "行きたい",
  neutral: "どちらでも",
  dont: "行きたくない",
  veryDont: "特に行きたくない",
};

// カテゴリごとの色設定
const CAT_COLORS: Record<
  CategoryType,
  { base: string; active: string; bg: string; bgActive: string; label: string }
> = {
  veryWant: {
    base: "#ef4444", // red-500
    active: "#dc2626", // red-600
    bg: "rgba(239,68,68,.05)",
    bgActive: "rgba(239,68,68,.12)",
    label: "#b91c1c", // red-700
  },
  want: {
    base: "#ec4899", // pink-500
    active: "#db2777", // pink-600
    bg: "rgba(236,72,153,.05)",
    bgActive: "rgba(236,72,153,.12)",
    label: "#be185d", // pink-700
  },
  neutral: {
    base: "#9ca3af", // gray-400/500 mix
    active: "#6b7280", // gray-500
    bg: "rgba(156,163,175,.05)",
    bgActive: "rgba(156,163,175,.12)",
    label: "#374151", // gray-700
  },
  dont: {
    base: "#38bdf8", // sky-400 （水色）
    active: "#0ea5e9", // sky-500
    bg: "rgba(14,165,233,.05)",
    bgActive: "rgba(14,165,233,.12)",
    label: "#075985", // sky-800
  },
  veryDont: {
    base: "#3b82f6", // blue-500
    active: "#2563eb", // blue-600
    bg: "rgba(59,130,246,.05)",
    bgActive: "rgba(59,130,246,.12)",
    label: "#1e40af", // blue-800
  },
};

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

function sortByIdNumber(a: { id: string }, b: { id: string }) {
  const ai = parseInt(a.id.replace("card", ""), 10);
  const bi = parseInt(b.id.replace("card", ""), 10);
  return ai - bi;
}

function normalizeCategories(cat: Categories): Categories {
  // 同一カードの重複を除去
  const seen = new Set<string>();
  const uniq = (arr: CardWithReason[]) =>
    arr.filter((c) => {
      if (!c) return false as any;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

  return {
    veryWant: uniq(cat.veryWant).sort(sortByIdNumber),
    want: uniq(cat.want).sort(sortByIdNumber),
    neutral: uniq(cat.neutral).sort(sortByIdNumber),
    dont: uniq(cat.dont).sort(sortByIdNumber),
    veryDont: uniq(cat.veryDont).sort(sortByIdNumber),
  };
}

export default function WaitingPage() {
  usePreventBack();
  const router = useRouter();
  const params = useParams();
  const { userName } = useUser();

  const roomId = (params?.roomId as string) || "";

  // 40枚のカード定義（USJ画像スキーマに合わせ）
  const allCards: CardInfo[] = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const idx = i + 1;
        return {
          id: `card${idx}`,
          title: `カード${idx}`,
          src: `/pngs/USJ_${idx}_surface-1.png`,
          backSrc: `/pngs/back/USJ_${idx}_back-1.png`,
        } as CardInfo;
      }),
    []
  );

  // --- Firestore から自分の最終配置（あれば）を購読 → 初期化 ---
  const [categories, setCategories] = useState<Categories>({
    veryWant: [],
    want: [],
    neutral: [],
    dont: [],
    veryDont: [],
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [planName, setPlanName] = useState("");
  const [participants, setParticipants] = useState<Record<string, string>>({});
  const [matchReadyData, setMatchReadyData] = useState<Record<string, boolean>>({});
  const [selfReady, setSelfReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [interactionLocked, setInteractionLocked] = useState(false);

  useEffect(() => {
    if (!roomId || !userName) return;
    const ref = doc(db, "rooms", roomId, "finalSelections", userName);
    const un = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const dat = snap.data();
        const pn = (dat as any).planname || (dat as any).planName || "";
        setPlanName(pn);
        if ((dat as any).isReady) { setSelfReady(true); setInteractionLocked(true); }
        const cat = (dat?.categories || {}) as Partial<Categories>;
        const build = (k: CategoryType) =>
          (cat[k] || []).map((x: any) => {
            const fullCardInfo = allCards.find(c => c.id === x.id);
            return {
              id: x.id,
              title: fullCardInfo?.title || x.title || `カード${x.id.replace('card', '')}`,
              src: fullCardInfo?.src || x.src || `/pngs/USJ_${x.id.replace('card', '')}_surface-1.png`,
              backSrc: fullCardInfo?.backSrc || x.backSrc || `/pngs/back/USJ_${x.id.replace('card', '')}_back-1.png`,
              reason: x.reason || "",
            };
          }) as CardWithReason[];
        setCategories(
          normalizeCategories({
            veryWant: build("veryWant"),
            want: build("want"),
            neutral: build("neutral"),
            dont: build("dont"),
            veryDont: build("veryDont"),
          })
        );
      } else {
        // 初期：全カードは neutral に置く（必要に応じて空でもOK）
        setCategories(
          normalizeCategories({
            veryWant: [],
            want: [],
            neutral: allCards.map((c) => ({ ...c })),
            dont: [],
            veryDont: [],
          })
        );
      }
      setIsHydrated(true);
    });
    return () => un();
  }, [roomId, userName, allCards]);

  // 参加者購読（rooms/{roomId}.participants）
  useEffect(() => {
    if (!roomId) return;
    const roomRef = doc(db, "rooms", roomId);
    const un = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        setParticipants((data?.participants || {}) as Record<string, string>);
      }
    });
    return () => un();
  }, [roomId]);

  // 準備状況購読（rooms/{roomId}/matchReady）
  useEffect(() => {
    if (!roomId) return;
    const q = query(collection(db, "rooms", roomId, "matchReady"));
    const un = onSnapshot(q, (snap) => {
      const map: Record<string, boolean> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (data?.ready) map[data.userId || d.id] = true;
      });
      setMatchReadyData(map);
    });
    return () => un();
  }, [roomId]);

  // --- Firestore 保存ヘルパ ---
  const saveCategories = useCallback(
    async (next: Categories) => {
      if (!roomId || !userName) return;
      setIsSaving(true);
      try {
        // カード情報を完全に保持するため、allCardsから情報を補完
        const enhanceCategory = (category: CardWithReason[]) => {
          return category.map(card => {
            const fullCardInfo = allCards.find(c => c.id === card.id);
            return {
              id: card.id,
              title: fullCardInfo?.title || card.title || `カード${card.id.replace('card', '')}`,
              src: fullCardInfo?.src || card.src || `/pngs/USJ_${card.id.replace('card', '')}_surface-1.png`,
              backSrc: fullCardInfo?.backSrc || card.backSrc || `/pngs/back/USJ_${card.id.replace('card', '')}_back-1.png`,
              reason: card.reason || ""
            };
          });
        };

        const enhancedNext = {
          veryWant: enhanceCategory(next.veryWant),
          want: enhanceCategory(next.want),
          neutral: enhanceCategory(next.neutral),
          dont: enhanceCategory(next.dont),
          veryDont: enhanceCategory(next.veryDont),
        };

        const ref = doc(db, "rooms", roomId, "finalSelections", userName);
        await setDoc(ref, {
          user: userName,
          userId: userName,
          userName,
          categories: enhancedNext,
          planname: planName || "",
          planName: planName || "", // 両方の形式で保存
          updatedAt: serverTimestamp(),
        }, { merge: true });
        
        console.log('Categories saved successfully:', enhancedNext);
      } catch (error) {
        console.error('Error saving categories:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [roomId, userName, planName, allCards]
  );

  // --- クリックピック状態 ---
  const [picked, setPicked] = useState<{
    card: CardWithReason | null;
    from: CategoryType | null;
  }>({ card: null, from: null });

  const [dropZone, setDropZone] = useState<CategoryType | null>(null);

  // --- 理由モーダル状態 ---
  const [reasonModal, setReasonModal] = useState<{
    isOpen: boolean;
    card: CardWithReason | null;
    category: CategoryType | null; // 現在いる（または移動先の）カテゴリ
    from: CategoryType | null;     // 元カテゴリ
    originalFrom: CategoryType | null; // 直前の本来の元カテゴリ（特に〜へ移動して直後の編集用）
    selectedIcon: number | null;
    customReason: string;
    flipped: boolean;
  }>({
    isOpen: false,
    card: null,
    category: null,
    from: null,
    originalFrom: null,
    selectedIcon: null,
    customReason: "",
    flipped: false,
  });

  // --- 特に〜から他カテゴリへ出すときの確認ダイアログ ---
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    card: CardWithReason | null;
    originalCategory: CategoryType | null;
    targetCategory: CategoryType | null;
  }>({ isOpen: false, card: null, originalCategory: null, targetCategory: null });

  // ------- ユーティリティ -------
  const getCategoryArray = useCallback(
    (cat: CategoryType, obj?: Categories) => (obj || categories)[cat],
    [categories]
  );

  const removeFromCategory = useCallback(
    (cardId: string, from: CategoryType, obj: Categories): Categories => {
      const cur = { ...obj } as Categories;
      cur[from] = cur[from].filter((c) => c.id !== cardId);
      return cur;
    },
    []
  );

  const addToCategory = useCallback(
    (card: CardWithReason, to: CategoryType, obj: Categories): Categories => {
      const cur = { ...obj } as Categories;
      cur[to] = [...cur[to], { ...card }];
      return cur;
    },
    []
  );

  // ------- ピック開始（通常カテゴリ） -------
  const startPick = useCallback((card: CardWithReason, from: CategoryType) => {
    if (interactionLocked) return;
    setPicked({ card, from });
  }, []);

  // ------- エリアへクリックでドロップ -------
  const attemptDropToCategory = useCallback(
    (target: CategoryType) => {
      if (!picked.card || !picked.from) return;
      const card = picked.card;

      // 1) target が 特に〜 → play2と同様に理由モーダル
      if (target === "veryWant" || target === "veryDont") {
        // まず仮でカードを target に移して、理由入力へ
        const base = removeFromCategory(card.id, picked.from, categories);
        const next = addToCategory({ ...card, reason: card.reason || "" }, target, base);
        setCategories(normalizeCategories(next));
        saveCategories(normalizeCategories(next));
        setPicked({ card: null, from: null });
        setReasonModal({
          isOpen: true,
          card: { ...card },
          category: target,
          from: target, // 現在は特に〜内
          originalFrom: picked.from, // 戻る先として保持
          selectedIcon: null,
          customReason: card.reason || "",
          flipped: false,
        });
        return;
      }

      // 2) from が 特に〜 かつ 理由がついている → 理由消去の確認
      if ((picked.from === "veryWant" || picked.from === "veryDont") && (card.reason && card.reason.length > 0)) {
        setConfirmDialog({
          isOpen: true,
          card: { ...card },
          originalCategory: picked.from,
          targetCategory: target,
        });
        return;
      }

      // 3) 通常移動
      const base = removeFromCategory(card.id, picked.from, categories);
      // 理由は通常カテゴリでは不要
      const { reason, ...rest } = card as any;
      const next = addToCategory(rest, target, base);
      const normalized = normalizeCategories(next);
      setCategories(normalized);
      saveCategories(normalized);
      setPicked({ card: null, from: null });
    },
    [picked, categories, addToCategory, removeFromCategory, saveCategories]
  );

  // ------- 理由モーダルを開く（特に〜をクリック時） -------
  const openReasonModal = useCallback(
    (cardId: string, category: CategoryType, from: CategoryType) => {
      const c = getCategoryArray(category).find((x) => x.id === cardId);
      if (!c) return;
      setReasonModal({
        isOpen: true,
        card: { ...c },
        category,
        from,
        originalFrom: null, // 既存編集は移動が伴わないので復元不要
        selectedIcon: null,
        customReason: c.reason || "",
        flipped: false,
      });
    },
    [getCategoryArray]
  );

  const closeReasonModal = () => setReasonModal((p) => ({ ...p, isOpen: false }));

  // ------- 理由モーダル：戻る（元エリアに戻す） -------
  const cancelReasonModal = useCallback(() => {
    const { card, category, originalFrom } = reasonModal;
    if (!card || !category) return closeReasonModal();

    // 元に戻す：originalFrom があればそこへ、無ければ現状維持でモーダルを閉じる
    if (originalFrom) {
      // カードの完全な情報を保持して元のカテゴリに戻す
      const fullCardInfo = allCards.find(c => c.id === card.id);
      const restoredCard = {
        id: card.id,
        title: fullCardInfo?.title || card.title || `カード${card.id.replace('card', '')}`,
        src: fullCardInfo?.src || card.src || `/pngs/USJ_${card.id.replace('card', '')}_surface-1.png`,
        backSrc: fullCardInfo?.backSrc || card.backSrc || `/pngs/back/USJ_${card.id.replace('card', '')}_back-1.png`,
        // 理由は除去（通常カテゴリに戻すため）
      };

      const base = removeFromCategory(card.id, category, categories);
      const next = addToCategory(restoredCard, originalFrom, base);
      const normalized = normalizeCategories(next);
      setCategories(normalized);
      saveCategories(normalized);
    }
    closeReasonModal();
  }, [reasonModal, categories, removeFromCategory, addToCategory, saveCategories, allCards]);

  // ------- 理由モーダル：決定 -------
  const confirmReason = useCallback(async () => {
    const { card, category, selectedIcon, customReason } = reasonModal;
    if (!card || !category) return closeReasonModal();

    const reasonText = (() => {
      if (selectedIcon !== null) return reasonIcons[selectedIcon].text;
      return (customReason || "").trim();
    })();

    // カードの完全な情報を保持
    const fullCardInfo = allCards.find(c => c.id === card.id);
    const updatedCard = {
      id: card.id,
      title: fullCardInfo?.title || card.title || `カード${card.id.replace('card', '')}`,
      src: fullCardInfo?.src || card.src || `/pngs/USJ_${card.id.replace('card', '')}_surface-1.png`,
      backSrc: fullCardInfo?.backSrc || card.backSrc || `/pngs/back/USJ_${card.id.replace('card', '')}_back-1.png`,
      reason: reasonText,
    };

    const base = removeFromCategory(card.id, category, categories);
    const next = addToCategory(updatedCard, category, base);
    const normalized = normalizeCategories(next);
    setCategories(normalized);
    await saveCategories(normalized);
    closeReasonModal();
  }, [reasonModal, categories, removeFromCategory, addToCategory, saveCategories, allCards]);

  // ------- 確認ダイアログ：理由を消して移動 -------
  const confirmDropWithoutReason = useCallback(() => {
    const { card, originalCategory, targetCategory } = confirmDialog;
    if (!card || !originalCategory || !targetCategory) return;

    // カードの完全な情報を保持して理由なしで target へ移動
    const fullCardInfo = allCards.find(c => c.id === card.id);
    const movedCard = {
      id: card.id,
      title: fullCardInfo?.title || card.title || `カード${card.id.replace('card', '')}`,
      src: fullCardInfo?.src || card.src || `/pngs/USJ_${card.id.replace('card', '')}_surface-1.png`,
      backSrc: fullCardInfo?.backSrc || card.backSrc || `/pngs/back/USJ_${card.id.replace('card', '')}_back-1.png`,
      // 理由は除去（通常カテゴリなので）
    };

    const base = removeFromCategory(card.id, originalCategory, categories);
    const next = addToCategory(movedCard, targetCategory, base);
    const normalized = normalizeCategories(next);
    setCategories(normalized);
    saveCategories(normalized);
    setConfirmDialog({ isOpen: false, card: null, originalCategory: null, targetCategory: null });
    setPicked({ card: null, from: null });
  }, [confirmDialog, categories, removeFromCategory, addToCategory, saveCategories, allCards]);

  const cancelConfirmDialog = () =>
    setConfirmDialog({ isOpen: false, card: null, originalCategory: null, targetCategory: null });

  // ------- UI：カード -------
  function CardItem({
    card,
    category,
  }: {
    card: CardWithReason;
    category: CategoryType;
  }) {
    const [hovered, setHovered] = useState(false);

    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (interactionLocked) return;
      // すべてのカテゴリでクリックはピック開始（特に〜も移動可能に）
      startPick(card, category);
    };

    const displayReason = card.reason || "";
    const reasonIcon = reasonIcons.find((r) => r.text === displayReason);
    const badgeText = reasonIcon ? `${reasonIcon.emoji} ${reasonIcon.text}` : displayReason;

    return (
      <div
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          width: 120,
          cursor: interactionLocked ? "default" : "pointer",
          userSelect: "none",
          borderRadius: 8,
          padding: 8,
          boxShadow: hovered ? "0 6px 16px rgba(0,0,0,.12)" : "none",
          // Safari ちらつき対策: 過度な transform は避ける
          transform: hovered ? "translateY(-2px)" : "none",
          transition: "all .12s ease-out",
          background: "#fff",
          border: "1px solid #e5e7eb",
        }}
      >
        <div style={{
          width: "100%",
          aspectRatio: "3/2",
          borderRadius: 6,
          background: `url(${card.src}) center/contain no-repeat`,
          backgroundColor: "#fff",
          marginBottom: 8,
        }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
          <div style={{ fontSize: ".9rem", fontWeight: 600 }}>{card.title}</div>
          {(category === "veryWant" || category === "veryDont") && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (interactionLocked) return;
                openReasonModal(card.id, category, category);
              }}
              title="理由を編集"
              style={{
                fontSize: 12,
                padding: "2px 6px",
                borderRadius: 6,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                color: "#374151",
                cursor: interactionLocked ? "default" : "pointer",
              }}
            >理由</button>
          )}
        </div>
        {displayReason && (
          <div style={{ marginTop: 6, fontSize: ".8rem", color: "#2563eb" }}>{badgeText}</div>
        )}
      </div>
    );
  }

  // ------- UI：カテゴリ -------
  function CategorySection({ category, cards }: { category: CategoryType; cards: CardWithReason[] }) {
    const isActiveDrop = picked.card !== null && dropZone === category;
    const color = CAT_COLORS[category];
    const border = isActiveDrop ? `3px solid ${color.active}` : `2px solid ${color.base}`;
    const bg = isActiveDrop ? color.bgActive : color.bg; // 常時薄い背景、アクティブ時は濃く

    return (
      <div
        onMouseEnter={() => { if (picked.card) setDropZone(category); }}
        onMouseLeave={() => { if (picked.card) setDropZone(null); }}
        onClick={() => { if (picked.card) attemptDropToCategory(category); }}
        style={{
          flex: 1,
          minHeight: 240,
          padding: 12,
          borderRadius: 12,
          border,
          background: bg,
          transition: "all .12s ease-in-out",
          pointerEvents: interactionLocked ? "none" : "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <strong style={{ color: color.label }}>{CATEGORY_LABEL[category]}</strong>
          {isActiveDrop && <span style={{ fontSize: 12, color: color.active }}>ここをクリックで配置</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {/* 左端の配置プレースホルダ（周囲は点線のまま） */}
          <div
            onMouseEnter={() => { if (picked.card) setDropZone(category); }}
            onMouseLeave={() => { if (picked.card) setDropZone(null); }}
            onClick={(e) => { e.stopPropagation(); if (picked.card) attemptDropToCategory(category); }}
            title={picked.card ? "ここに配置" : "カードを選ぶとここに配置できます"}
            aria-label="配置可能プレースホルダ"
            style={{
              width: 120,
              borderRadius: 8,
              padding: 8,
              border: `2px dotted ${color.base}`,
              background: isActiveDrop ? color.bgActive : "#fff",
              color: color.label,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 120 * (2/3) + 16, // 画像枠相当の高さ + パディング目安
              cursor: picked.card && !interactionLocked ? "pointer" : "default",
              userSelect: "none",
            }}
          >
            配置可能
          </div>
          {cards.sort(sortByIdNumber).map((c) => (
            <CardItem key={c.id} card={c} category={category} />
          ))}
        </div>
      </div>
    );
  }

  // 進捗やハンドラ計算の前に、後段で使うコールバックを全て定義しておく（Hooks順序を安定化）
  const markMatchReady = useCallback(async () => {
    if (!roomId || !userName) return;
    if (selfReady || isSaving) return;
    try {
      setIsSaving(true);
      // finalSelections を確定保存
      await setDoc(doc(db, "rooms", roomId, "finalSelections", userName), {
        user: userName,
        userId: userName,
        userName,
        categories,
        planname: planName || "",
        isReady: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      // matchReady に登録
      await setDoc(doc(db, "rooms", roomId, "matchReady", userName), {
        userId: userName,
        ready: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setSelfReady(true);
      setInteractionLocked(true);
    } finally {
      setIsSaving(false);
    }
  }, [roomId, userName, categories, planName, selfReady, isSaving]);

  if (!isHydrated) return <div style={{ padding: 24 }}>読み込み中…</div>;

  // 進捗
  const matchReadyCount = Object.values(matchReadyData).filter(Boolean).length;
  const totalParticipants = Object.keys(participants).length || 0;
  const veryWantCount = categories.veryWant.length;
  const veryDontCount = categories.veryDont.length;
  const reasonCount = [...categories.veryWant, ...categories.veryDont].filter(c => (c.reason || "").trim().length > 0).length;
  const hasReasons = (veryWantCount + veryDontCount) > 0 && reasonCount === (veryWantCount + veryDontCount);

  

  return (
    <>
      <div style={{ padding: 16 }}>
        {/* ヘッダー（前UIに近づけ） */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, color: "#111827", margin: 0 }}>プラン調整</h1>
          <div style={{ marginTop: 6, fontSize: 18, color: "#2563eb", fontWeight: 600 }}>ユーザー名：{userName}</div>
          {/* プラン名 */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 12 }}>
            <span style={{ fontSize: 16, color: "#374151", fontWeight: 600 }}>プラン名:</span>
            <input
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              onBlur={() => saveCategories(categories)}
              placeholder="プラン名を入力してください"
              style={{
                fontSize: 18,
                color: "#2563EB",
                backgroundColor: "#FFFFFF",
                border: "2px solid #93C5FD",
                outline: "none",
                borderRadius: 8,
                padding: "6px 14px",
                minWidth: 240,
              }}
              disabled={interactionLocked}
            />
          </div>
          {/* 合致率ボタン */}
          <div style={{ marginTop: 14 }}>
            <button
              onClick={markMatchReady}
              disabled={selfReady || isSaving}
              style={{
                padding: "12px 24px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 18,
                border: "none",
                cursor: (selfReady || isSaving) ? "not-allowed" : "pointer",
                transition: "background-color .2s",
                backgroundColor: (selfReady ? "#9CA3AF" : "#2563EB"),
                color: "#fff",
              }}
            >
              {selfReady ? '準備完了済み' : (isSaving ? '保存中…' : `合致率を見る (${matchReadyCount}/${totalParticipants || '-'})`)}
            </button>
            {/* 進行状況 */}
            {totalParticipants > 0 && (
              <div style={{ marginTop: 6, fontSize: 13, color: matchReadyCount === totalParticipants && totalParticipants>0 ? '#10B981' : '#6B7280' }}>
                {matchReadyCount === totalParticipants && totalParticipants>0 ? '全員準備完了！まもなく合致率画面に移動します…' : `${matchReadyCount} / ${totalParticipants} 人が準備完了`}
              </div>
            )}
            {/* 理由未入力の注意（ボタンは押せる） */}
            {(!hasReasons && (veryWantCount + veryDontCount) > 0) && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c' }}>
                特に系に理由未入力のカードがあります（後からでも編集できます）
              </div>
            )}
          </div>
        </div>
        {/* ピック中ヒント */}
        {picked.card && (
          <div style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "#fffbeb",
            border: "1px solid #facc15",
            color: "#92400e",
            padding: 8,
            borderRadius: 8,
            marginBottom: 12,
          }}>
            「{picked.card.title}」の移動先のエリアにカーソルを合わせ、<strong>エリア内をクリック</strong>してください
          </div>
        )}

        {/* 5カテゴリレイアウト */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <CategorySection category="veryWant" cards={categories.veryWant} />
          <CategorySection category="want" cards={categories.want} />
          <CategorySection category="neutral" cards={categories.neutral} />
          <CategorySection category="dont" cards={categories.dont} />
          <CategorySection category="veryDont" cards={categories.veryDont} />
        </div>
      </div>

      {/* 確認ダイアログ：特に〜から出す時 */}
      {confirmDialog.isOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ width: 440, background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 12px 32px rgba(0,0,0,.28)" }}>
            <h3 style={{ margin: "0 0 10px" }}>理由を消して移動しますか？</h3>
            <p style={{ margin: "0 0 14px", lineHeight: 1.6 }}>
              「{confirmDialog.card?.title}」は「{confirmDialog.originalCategory && CATEGORY_LABEL[confirmDialog.originalCategory]}」で理由が設定されています。<br/>
              「{confirmDialog.targetCategory && CATEGORY_LABEL[confirmDialog.targetCategory]}」へ移動すると、このカードの <strong>理由は消去</strong> されます。
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={cancelConfirmDialog}
                style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D1D5DB", background: "#F3F4F6", cursor: "pointer" }}
              >キャンセル</button>
              <button
                onClick={confirmDropWithoutReason}
                style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#2563EB", color: "#fff", cursor: "pointer" }}
              >理由を消して移動</button>
            </div>
          </div>
        </div>
      )}

      {/* 理由モーダル（play2準拠の簡易版） */}
      {reasonModal.isOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 3000 }}
          onClick={(e) => { if (e.target === e.currentTarget) cancelReasonModal(); }}
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
            {/* ヘッダー（play2と同じ文言） */}
            <div style={{ textAlign: "center", marginBottom: 24, fontSize: "1.2rem", fontWeight: "bold" }}>
              このカードを選んだ理由を選択・入力してください
            </div>

            {/* メイン：左プレビュー / 右アイコン＋テキスト */}
            <div style={{ flex: 1, display: "flex", gap: 24 }}>
              {/* 左：カードプレビュー */}
              <div style={{ flex: "0 0 240px", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 12, paddingBottom: 12 }}>
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
                  onClick={() => setReasonModal((p) => ({ ...p, flipped: !p.flipped }))}
                >
                  <img
                    src={reasonModal.flipped ? reasonModal.card?.backSrc : reasonModal.card?.src}
                    alt={reasonModal.card?.title || "card"}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </div>
                <div style={{ marginTop: 12, fontSize: "1rem", fontWeight: "bold", textAlign: "center" }}>
                  {reasonModal.card?.title}
                </div>
              </div>

              {/* 右：アイコン選択 + テキスト */}
              <div style={{ flex: 1 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 24 }}>
                  {reasonIcons.map((icon, i) => (
                    <div
                      key={icon.text}
                      onClick={() => setReasonModal((p) => ({ ...p, selectedIcon: i, customReason: "" }))}
                      style={{
                        padding: 12,
                        border: reasonModal.selectedIcon === i ? "3px solid #2196f3" : "1px solid #ddd",
                        borderRadius: 8,
                        cursor: "pointer",
                        textAlign: "center",
                        backgroundColor: reasonModal.selectedIcon === i ? "#e3f2fd" : "#fff",
                        transition: "all .2s ease",
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

                <textarea
                  value={reasonModal.customReason}
                  onChange={(e) => setReasonModal((p) => ({ ...p, customReason: e.target.value, selectedIcon: null }))}
                  placeholder={reasonModal.selectedIcon !== null ? reasonIcons[reasonModal.selectedIcon].text : "理由を記入して下さい"}
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
                {/* 注意メッセージ */}
                {(!reasonModal.customReason.trim() && reasonModal.selectedIcon === null) && (
                  <div style={{ marginTop: 8, color: "#b91c1c", fontSize: ".9rem" }}>
                    理由アイコンを選ぶか、自由記入を入力してください
                  </div>
                )}
              </div>
            </div>

            {/* フッター：ボタン */}
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 24 }}>
              <button
                onClick={confirmReason}
                disabled={!reasonModal.customReason.trim() && reasonModal.selectedIcon === null}
                style={{
                  padding: "12px 24px",
                  fontSize: "1rem",
                  backgroundColor: (!reasonModal.customReason.trim() && reasonModal.selectedIcon === null) ? "#9ca3af" : "#2196f3",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: (!reasonModal.customReason.trim() && reasonModal.selectedIcon === null) ? "not-allowed" : "pointer",
                }}
              >
                決定
              </button>
              <button
                onClick={cancelReasonModal}
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
