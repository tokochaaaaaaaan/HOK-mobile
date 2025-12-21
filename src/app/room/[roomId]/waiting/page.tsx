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
  getDocs,
  addDoc,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import MapButton from "@/components/MapButton";
import styles from "./page.module.css";

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
  { key: "gourmet", src: "/emoji/gourmet.svg", emoji: "🍽️", text: "食", fullText: "食事" },
  { key: "thrill", src: "/emoji/thrill.svg", emoji: "🎢", text: "激", fullText: "スリル" },
  { key: "experience", src: "/emoji/experience.svg", emoji: "🎯", text: "体", fullText: "体験" },
  { key: "shopping", src: "/emoji/shopping.svg", emoji: "🛍️", text: "買", fullText: "買い物" },
  { key: "design", src: "/emoji/design.svg", emoji: "🏛️", text: "建築", fullText: "建築・デザイン" },
  { key: "scenery", src: "/emoji/scenery.svg", emoji: "🌅", text: "景", fullText: "景色" },
  { key: "time", src: "/emoji/time.svg", emoji: "⏰", text: "時", fullText: "時間" },
  { key: "cost", src: "/emoji/cost.svg", emoji: "💰", text: "¥", fullText: "コスパ" },
  { key: "friends", src: "/emoji/friends.svg", emoji: "👥", text: "友", fullText: "友達と一緒に" },
  { key: "family", src: "/emoji/family.svg", emoji: "👨‍👩‍👧‍👦", text: "家", fullText: "家族向け" },
  { key: "relax", src: "/emoji/relax.svg", emoji: "🧘", text: "休", fullText: "リラックス" },
  { key: "other", src: "/emoji/other.svg", emoji: "❗", text: "他", fullText: "その他" }
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

  const allCards: CardInfo[] = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const idx = i + 1;
        return {
          id: `card${idx}`,
          title: cardTitles[i],
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
  // カード移動履歴用：各カードの移動回数を記録
  const [cardMoveCount, setCardMoveCount] = useState<Record<string, number>>({});

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
        
        // play2の保存形式（verywant/verydont）も考慮
        const rawData = dat as any;
        const getCategoryData = (k: CategoryType) => {
          // 新形式をチェック
          if (cat[k] && cat[k].length > 0) return cat[k];
          
          // play2の保存形式をチェック
          if (k === 'veryWant' && rawData.verywant) return rawData.verywant;
          if (k === 'veryDont' && rawData.verydont) return rawData.verydont;
          
          // 旧形式をチェック
          if (k === 'want' && rawData.want) {
            return rawData.want.map((cardId: string) => allCards.find(c => c.id === cardId)).filter(Boolean);
          }
          if (k === 'neutral' && rawData.neutral) {
            return rawData.neutral.map((cardId: string) => allCards.find(c => c.id === cardId)).filter(Boolean);
          }
          if (k === 'dont' && rawData.dont) {
            return rawData.dont.map((cardId: string) => allCards.find(c => c.id === cardId)).filter(Boolean);
          }
          
          return [];
        };
        
        const build = (k: CategoryType) =>
          getCategoryData(k).map((x: any) => {
            const fullCardInfo = allCards.find(c => c.id === (x.id || x));
            const cardId = x.id || x;
            
            // 理由の取得：優先順位 1) x.reason, 2) rawData.reasons[cardId]
            let reason = x.reason || "";
            if (!reason && rawData.reasons && rawData.reasons[cardId]) {
              reason = rawData.reasons[cardId];
            }
            
            console.log(`Building ${k} card:`, { cardId, originalData: x, reason, fromReasons: rawData.reasons?.[cardId] });
            return {
              id: cardId,
              title: fullCardInfo?.title || x.title || `カード${cardId.replace('card', '')}`,
              src: fullCardInfo?.src || x.src || `/pngs/USJ_${cardId.replace('card', '')}_surface-1.png`,
              backSrc: fullCardInfo?.backSrc || x.backSrc || `/pngs/back/USJ_${cardId.replace('card', '')}_back-1.png`,
              reason: reason,
            };
          }) as CardWithReason[];
          
        console.log('Waiting page data loaded:', {
          categories: cat,
          rawData: { 
            verywant: rawData.verywant, 
            verydont: rawData.verydont, 
            want: rawData.want, 
            neutral: rawData.neutral, 
            dont: rawData.dont,
            reasons: rawData.reasons 
          },
          builtCategories: {
            veryWant: build("veryWant"),
            veryDont: build("veryDont")
          }
        });
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

  // 全員準備完了時の自動遷移
  useEffect(() => {
    const readyCount = Object.values(matchReadyData).filter(Boolean).length;
    // participantsが空の場合は、matchReadyDataから参加者を推測
    const participantIds = Object.keys(participants).length > 0 
      ? Object.keys(participants) 
      : Object.keys(matchReadyData);
    const totalCount = participantIds.length;
    
    console.log('Ready check:', { 
      readyCount, 
      totalCount, 
      participants, 
      matchReadyData,
      participantIds 
    });
    
    // 最低2人以上で全員準備完了の場合にリダイレクト
    if (totalCount >= 2 && readyCount === totalCount && readyCount > 0) {
      console.log('All participants ready, redirecting to match-result...');
      // 少し遅延を入れてからリダイレクト（UIフィードバックのため）
      const timer = setTimeout(() => {
        router.push(`/room/${roomId}/match-result`);
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [matchReadyData, participants, router, roomId]);

  // --- カード移動履歴を記録 ---
  const saveMovementHistory = useCallback(
    async (cardId: string, fromCategory: CategoryType, toCategory: CategoryType) => {
      if (!roomId || !userName) return;
      
      try {
        // この特定カードの移動回数を取得・更新
        const currentCount = cardMoveCount[cardId] || 0;
        const newCount = currentCount + 1;
        
        // カウンターを更新
        setCardMoveCount(prev => ({
          ...prev,
          [cardId]: newCount,
        }));
        
        // waiting_result/{userName}サブコレクションに記録
        const movementRef = collection(db, "waiting_result", userName, "movements");
        await addDoc(movementRef, {
          documentName: `${cardId}_${newCount}`,
          cardId: cardId,
          from: fromCategory,
          to: toCategory,
          timestamp: serverTimestamp(),
          movedAt: new Date().toISOString(),
          moveCount: newCount,
        });
        
        console.log(`Movement recorded: ${cardId}_${newCount} from ${fromCategory} to ${toCategory}`);
      } catch (error) {
        console.error('Error saving movement history:', error);
      }
    },
    [roomId, userName, cardMoveCount]
  );

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
            const baseCard = {
              id: card.id,
              title: fullCardInfo?.title || card.title || `カード${card.id.replace('card', '')}`,
              src: fullCardInfo?.src || card.src || `/pngs/USJ_${card.id.replace('card', '')}_surface-1.png`,
              backSrc: fullCardInfo?.backSrc || card.backSrc || `/pngs/back/USJ_${card.id.replace('card', '')}_back-1.png`,
            };
            
            // 理由がある場合のみreasonプロパティを追加
            if (card.reason && card.reason.trim()) {
              return { ...baseCard, reason: card.reason };
            }
            return baseCard;
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
          lastModified: new Date().toISOString(), // クライアント側のタイムスタンプも保存
          // 実験データ用の旧形式も保存（小文字）
          verywant: enhancedNext.veryWant,
          verydont: enhancedNext.veryDont,
          want: enhancedNext.want.map(c => c.id),
          neutral: enhancedNext.neutral.map(c => c.id),
          dont: enhancedNext.dont.map(c => c.id),
          // 理由も別途保存
          reasons: (() => {
            const reasonsMap: Record<string, string> = {};
            [...enhancedNext.veryWant, ...enhancedNext.veryDont].forEach((card: any) => {
              if (card.reason && card.reason.trim()) {
                reasonsMap[card.id] = card.reason;
              }
            });
            return reasonsMap;
          })(),
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

      // 共通: 元が特に〜で理由がある場合で、移動先が異なる場所の場合 → 理由消去の確認
      const fromIsSpecial = picked.from === "veryWant" || picked.from === "veryDont";
      const targetIsSpecial = target === "veryWant" || target === "veryDont";
      const hasReason = card.reason && card.reason.length > 0;
      const isDifferentCategory = target !== picked.from;

      if (fromIsSpecial && hasReason && isDifferentCategory) {
        setConfirmDialog({
          isOpen: true,
          card: { ...card },
          originalCategory: picked.from,
          targetCategory: target,
        });
        return;
      }

      // 1) target が 特に〜で元と同じ場所の場合 → 理由編集用にモーダル開く
      if (targetIsSpecial && target === picked.from) {
        const base = removeFromCategory(card.id, picked.from, categories);
        const next = addToCategory({ ...card, reason: card.reason || "" }, target, base);
        setCategories(normalizeCategories(next));
        saveCategories(normalizeCategories(next));
        setPicked({ card: null, from: null });
        setReasonModal({
          isOpen: true,
          card: { ...card },
          category: target,
          from: target,
          originalFrom: target,
          selectedIcon: null,
          customReason: card.reason || "",
          flipped: false,
        });
        return;
      }

      // 2) 通常カテゴリから特に〜へ移動 → 理由モーダルを開く
      if (targetIsSpecial && !fromIsSpecial) {
        const base = removeFromCategory(card.id, picked.from, categories);
        const next = addToCategory({ ...card, reason: card.reason || "" }, target, base);
        setCategories(normalizeCategories(next));
        saveCategories(normalizeCategories(next));
        // カード移動履歴を記録
        saveMovementHistory(card.id, picked.from, target);
        setPicked({ card: null, from: null });
        setReasonModal({
          isOpen: true,
          card: { ...card },
          category: target,
          from: target,
          originalFrom: picked.from,
          selectedIcon: null,
          customReason: card.reason || "",
          flipped: false,
        });
        return;
      }

      // 3) 通常カテゴリへの通常移動（特に〜から理由なしで移動、または通常同士の移動）
      const base = removeFromCategory(card.id, picked.from, categories);
      // 理由は通常カテゴリでは不要なので必ず除去
      // allCardsから元の情報を取得して、理由なしの新しいオブジェクトを作成
      const fullCardInfo = allCards.find(c => c.id === card.id);
      const movedCard: CardInfo = {
        id: card.id,
        title: fullCardInfo?.title || card.title,
        src: fullCardInfo?.src || card.src,
        backSrc: fullCardInfo?.backSrc || card.backSrc,
      };
      const next = addToCategory(movedCard, target, base);
      const normalized = normalizeCategories(next);
      setCategories(normalized);
      saveCategories(normalized);
      // カード移動履歴を記録
      saveMovementHistory(card.id, picked.from, target);
      setPicked({ card: null, from: null });
    },
    [picked, categories, addToCategory, removeFromCategory, saveCategories, saveMovementHistory, allCards]
  );

  // ------- 理由モーダルを開く（特に〜をクリック時） -------
  const openReasonModal = useCallback(
    (cardId: string, category: CategoryType, from: CategoryType) => {
      const c = getCategoryArray(category).find((x) => x.id === cardId);
      if (!c) return;
      
      const existingReason = c.reason || "";
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
        card: { ...c },
        category,
        from,
        originalFrom: null, // 既存編集は移動が伴わないので復元不要
        selectedIcon,
        customReason,
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

    let finalReason = "";
    
    // 理由の生成ロジック：selectedIcon か customReason のどちらかが必須（既にボタン無効化で防止済み）
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
    } else if (customReason.trim()) {
      // アイコンが選択されていない場合: カスタムテキストのみ
      finalReason = customReason.trim();
    } else {
      // 両方なし（ボタン無効化で防止されているはずだが、念のため）
      finalReason = "";
    }

    // カードの完全な情報を保持
    const fullCardInfo = allCards.find(c => c.id === card.id);
    const updatedCard = {
      id: card.id,
      title: fullCardInfo?.title || card.title || `カード${card.id.replace('card', '')}`,
      src: fullCardInfo?.src || card.src || `/pngs/USJ_${card.id.replace('card', '')}_surface-1.png`,
      backSrc: fullCardInfo?.backSrc || card.backSrc || `/pngs/back/USJ_${card.id.replace('card', '')}_back-1.png`,
      reason: finalReason,
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
      // 理由は除去
      reason: "",
    };

    const base = removeFromCategory(card.id, originalCategory, categories);
    const next = addToCategory(movedCard, targetCategory, base);
    const normalized = normalizeCategories(next);
    setCategories(normalized);
    saveCategories(normalized);
    // カード移動履歴を記録
    saveMovementHistory(card.id, originalCategory, targetCategory);
    setConfirmDialog({ isOpen: false, card: null, originalCategory: null, targetCategory: null });
    setPicked({ card: null, from: null });
    
    // 移動先が特に〜の場合のみ理由モーダルを開く
    // （通常カテゴリへの移動の場合はモーダルを開かない）
    if (targetCategory === "veryWant" || targetCategory === "veryDont") {
      // 理由なしのカードオブジェクトを作成してモーダルで表示
      const cardWithoutReason = {
        id: movedCard.id,
        title: movedCard.title,
        src: movedCard.src,
        backSrc: movedCard.backSrc,
        // 理由は含めない
      } as CardWithReason;
      
      setReasonModal({
        isOpen: true,
        card: cardWithoutReason,
        category: targetCategory,
        from: targetCategory,
        originalFrom: originalCategory,
        selectedIcon: null,
        customReason: "",
        flipped: false,
      });
    }
  }, [confirmDialog, categories, removeFromCategory, addToCategory, saveCategories, saveMovementHistory, allCards]);

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

    // 理由を解析してアイコンとテキストを分離
    const reason = card.reason || "";
    let displayEmoji = "";
    let displayText = "";
    
    if (reason && reason.trim()) {
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
        </div>
        {displayText && (
          <div style={{ 
            marginTop: 4, 
            fontSize: ".65rem", 
            color: "#fff", 
            fontWeight: 500,
            lineHeight: 1.3,
            backgroundColor: "rgba(0,0,0,0.85)",
            padding: "2px 6px",
            borderRadius: 4,
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleFinishClick = () => {
    // 確認モーダルを表示
    setShowConfirmModal(true);
  };

  const markMatchReady = useCallback(async () => {
    if (!roomId || !userName) return;
    if (selfReady || isSaving) return;
    try {
      setIsSaving(true);
      const submittedAt = new Date().toISOString();
      
      // finalSelections を確定保存（merge: trueで既存データを保持）
      await setDoc(doc(db, "rooms", roomId, "finalSelections", userName), {
        user: userName,
        userId: userName,
        userName,
        categories,
        planname: planName || "",
        planName: planName || "",  // 両方のフィールド名を保存
        isReady: true,
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
      }, { merge: true });
      
      // matchReady に登録
      await setDoc(doc(db, "rooms", roomId, "matchReady", userName), {
        userId: userName,
        ready: true,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      
      // waiting_result_last に最終結果を保存
      await setDoc(doc(db, "waiting_result_last", userName, "result_last", "final"), {
        userName: userName,
        submittedAt: submittedAt,
        timestamp: serverTimestamp(),
        planName: planName || "",
        finalPlacement: {
          veryWant: categories.veryWant.map(c => ({
            cardId: c.id,
            title: c.title,
            reason: c.reason || "",
          })),
          want: categories.want.map(c => ({
            cardId: c.id,
            title: c.title,
          })),
          neutral: categories.neutral.map(c => ({
            cardId: c.id,
            title: c.title,
          })),
          dont: categories.dont.map(c => ({
            cardId: c.id,
            title: c.title,
          })),
          veryDont: categories.veryDont.map(c => ({
            cardId: c.id,
            title: c.title,
            reason: c.reason || "",
          })),
        },
        // 各カテゴリのカードID配列も保存（クエリしやすいように）
        veryWantCards: categories.veryWant.map(c => c.id),
        wantCards: categories.want.map(c => c.id),
        neutralCards: categories.neutral.map(c => c.id),
        dontCards: categories.dont.map(c => c.id),
        veryDontCards: categories.veryDont.map(c => c.id),
      });
      
      console.log(`Final result saved for ${userName} at ${submittedAt}`);
      
      setSelfReady(true);
      setInteractionLocked(true);
      setShowConfirmModal(false);
    } finally {
      setIsSaving(false);
    }
  }, [roomId, userName, categories, planName, selfReady, isSaving]);

  if (!isHydrated) return <div style={{ padding: 24 }}>読み込み中…</div>;

  // 進捗
  const matchReadyCount = Object.values(matchReadyData).filter(Boolean).length;
  const participantIds = Object.keys(participants).length > 0 
    ? Object.keys(participants) 
    : Object.keys(matchReadyData);
  const totalParticipants = participantIds.length;
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
              onClick={handleFinishClick}
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

      {/* 理由モーダル（play2と完全に同じUI） */}
      {reasonModal.isOpen && reasonModal.card && (
        <div
          style={{ 
            position: "fixed", 
            inset: 0, 
            background: "rgba(0,0,0,0.5)", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            zIndex: 3000 
          }}
          onClick={(e) => { if (e.target === e.currentTarget) cancelReasonModal(); }}
        >
          <div className={styles.reasonModal}>
            {/* ヘッダー */}
            <div className={styles.reasonModalTitle}>
              このカードを選んだ理由を選択・入力してください
            </div>

            {/* メインコンテンツ */}
            <div style={{ flex: 1, display: "flex", gap: 24 }}>
              {/* 左側：カード表示 */}
              <div style={{ flex: "0 0 240px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div className={styles.cardPreview}>
                  <div
                    className={`${styles.cardPreviewInner} ${reasonModal.flipped ? styles.flipped : ""}`}
                    onClick={() => setReasonModal((p) => ({ ...p, flipped: !p.flipped }))}
                  >
                    <div className={styles.cardFace}>
                      <img
                        src={reasonModal.card.src}
                        alt={reasonModal.card.title}
                      />
                    </div>
                    <div className={`${styles.cardFace} ${styles.cardBack}`}>
                      <img
                        src={reasonModal.card.backSrc}
                        alt={reasonModal.card.title}
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
                <div style={{ fontSize: "1rem", fontWeight: "bold", textAlign: "center" }}>
                  {reasonModal.card.title}
                </div>
              </div>

              {/* 右側：アイコン選択 */}
              <div style={{ flex: 1 }}>
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

                {/* 警告メッセージ */}
                {reasonModal.selectedIcon === null && reasonModal.customReason.trim() === "" && (
                  <div style={{
                    marginTop: 12,
                    padding: "8px 12px",
                    backgroundColor: "#fecaca",
                    color: "#dc2626",
                    borderRadius: 4,
                    fontSize: "0.9rem",
                    fontWeight: 500,
                    textAlign: "center"
                  }}>
                    理由を選んでください
                  </div>
                )}
              </div>
            </div>

            {/* フッター：ボタン */}
            <div className={styles.modalButtons}>
              <button
                onClick={confirmReason}
                disabled={reasonModal.selectedIcon === null && reasonModal.customReason.trim() === ""}
                className={`${styles.button} ${styles.buttonConfirm}`}
                style={{
                  opacity: reasonModal.selectedIcon === null && reasonModal.customReason.trim() === "" ? 0.5 : 1,
                  cursor: reasonModal.selectedIcon === null && reasonModal.customReason.trim() === "" ? "not-allowed" : "pointer",
                }}
              >
                決定
              </button>
              <button
                onClick={cancelReasonModal}
                className={`${styles.button} ${styles.buttonCancel}`}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 最終確認モーダル (play2スタイル) */}
      {showConfirmModal && (
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
              setShowConfirmModal(false);
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
            {/* ヘッダー：ユーザー名とプラン名 */}
            <div style={{ 
              marginBottom: 20, 
              padding: 16,
              background: "#fff",
              border: "2px solid #667eea",
              borderRadius: 8,
              flexShrink: 0
            }}>
              <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: 4 }}>
                ユーザー名
              </div>
              <div style={{ fontSize: "1.3rem", fontWeight: "bold", marginBottom: 12, color: "#1f2937" }}>
                {userName}
              </div>
              <div style={{ fontSize: "0.9rem", color: "#6b7280", marginBottom: 4 }}>
                プラン名
              </div>
              <div style={{ fontSize: "1.3rem", fontWeight: "bold", color: "#1f2937" }}>
                {planName || "未設定"}
              </div>
            </div>

            <p style={{ marginBottom: 16, fontSize: "1.1rem", flexShrink: 0, textAlign: "center", fontWeight: 600 }}>
              最後に選択内容を確認してください
            </p>

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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {categories.veryWant.length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    categories.veryWant.map((card) => (
                      <div key={card.id} style={{ position: "relative", width: 80 }}>
                        <img
                          src={card.src}
                          alt={card.title}
                          style={{
                            width: "100%",
                            borderRadius: 4,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            border: "2px solid #ef4444",
                          }}
                        />
                        {card.reason && (
                          <div style={{
                            position: "absolute",
                            bottom: 4,
                            left: "50%",
                            transform: "translateX(-50%)",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "0.25rem",
                            padding: "0.35rem 0.5rem",
                            backgroundColor: "rgba(0,0,0,0.85)",
                            color: "#fff",
                            borderRadius: "0.375rem",
                            maxWidth: "76px",
                            width: "max-content",
                            boxSizing: "border-box",
                          }}>
                            {(() => {
                              // 理由を解析: "fullText:customText" または "fullText" または "customText"
                              const colonIndex = card.reason.indexOf(':');
                              let displayText = card.reason;
                              let emoji = "";
                              
                              if (colonIndex !== -1) {
                                const iconPart = card.reason.substring(0, colonIndex);
                                const customPart = card.reason.substring(colonIndex + 1);
                                const icon = reasonIcons.find(ic => ic.fullText === iconPart);
                                if (icon) {
                                  emoji = icon.emoji;
                                  displayText = customPart;
                                } else {
                                  displayText = card.reason;
                                }
                              } else {
                                const icon = reasonIcons.find(ic => ic.fullText === card.reason);
                                if (icon) {
                                  emoji = icon.emoji;
                                  displayText = icon.fullText;
                                }
                              }
                              
                              return (
                                <>
                                  {emoji && (
                                    <span style={{ 
                                      fontSize: "0.85rem", 
                                      flexShrink: 0, 
                                      lineHeight: 1, 
                                      marginTop: "1px" 
                                    }}>
                                      {emoji}
                                    </span>
                                  )}
                                  <span style={{
                                    fontSize: "0.65rem",
                                    lineHeight: 1.3,
                                    wordWrap: "break-word",
                                    overflowWrap: "break-word",
                                    wordBreak: "break-word",
                                    whiteSpace: "normal",
                                    flex: 1,
                                    minWidth: 0,
                                  }}>
                                    {displayText}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 行きたいカード */}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {categories.want.length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    categories.want.map((card) => (
                      <div key={card.id} style={{ width: 80 }}>
                        <img
                          src={card.src}
                          alt={card.title}
                          style={{
                            width: "100%",
                            borderRadius: 4,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            border: "2px solid #ec4899",
                          }}
                        />
                      </div>
                    ))
                  )}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {categories.neutral.length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    categories.neutral.map((card) => (
                      <div key={card.id} style={{ width: 80 }}>
                        <img
                          src={card.src}
                          alt={card.title}
                          style={{
                            width: "100%",
                            borderRadius: 4,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            border: "2px solid #9ca3af",
                          }}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 行きたくないカード */}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {categories.dont.length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    categories.dont.map((card) => (
                      <div key={card.id} style={{ width: 80 }}>
                        <img
                          src={card.src}
                          alt={card.title}
                          style={{
                            width: "100%",
                            borderRadius: 4,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            border: "2px solid #06b6d4",
                          }}
                        />
                      </div>
                    ))
                  )}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {categories.veryDont.length === 0 ? (
                    <p style={{ color: "#9ca3af", fontSize: "0.9rem", marginLeft: 8 }}>なし</p>
                  ) : (
                    categories.veryDont.map((card) => (
                      <div key={card.id} style={{ position: "relative", width: 80 }}>
                        <img
                          src={card.src}
                          alt={card.title}
                          style={{
                            width: "100%",
                            borderRadius: 4,
                            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                            border: "2px solid #3b82f6",
                          }}
                        />
                        {card.reason && (
                          <div style={{
                            position: "absolute",
                            bottom: 4,
                            left: "50%",
                            transform: "translateX(-50%)",
                            display: "flex",
                            alignItems: "flex-start",
                            gap: "0.25rem",
                            padding: "0.35rem 0.5rem",
                            backgroundColor: "rgba(0,0,0,0.85)",
                            color: "#fff",
                            borderRadius: "0.375rem",
                            maxWidth: "76px",
                            width: "max-content",
                            boxSizing: "border-box",
                          }}>
                            {(() => {
                              // 理由を解析: "fullText:customText" または "fullText" または "customText"
                              const colonIndex = card.reason.indexOf(':');
                              let displayText = card.reason;
                              let emoji = "";
                              
                              if (colonIndex !== -1) {
                                const iconPart = card.reason.substring(0, colonIndex);
                                const customPart = card.reason.substring(colonIndex + 1);
                                const icon = reasonIcons.find(ic => ic.fullText === iconPart);
                                if (icon) {
                                  emoji = icon.emoji;
                                  displayText = customPart;
                                } else {
                                  displayText = card.reason;
                                }
                              } else {
                                const icon = reasonIcons.find(ic => ic.fullText === card.reason);
                                if (icon) {
                                  emoji = icon.emoji;
                                  displayText = icon.fullText;
                                }
                              }
                              
                              return (
                                <>
                                  {emoji && (
                                    <span style={{ 
                                      fontSize: "0.85rem", 
                                      flexShrink: 0, 
                                      lineHeight: 1, 
                                      marginTop: "1px" 
                                    }}>
                                      {emoji}
                                    </span>
                                  )}
                                  <span style={{
                                    fontSize: "0.65rem",
                                    lineHeight: 1.3,
                                    wordWrap: "break-word",
                                    overflowWrap: "break-word",
                                    wordBreak: "break-word",
                                    whiteSpace: "normal",
                                    flex: 1,
                                    minWidth: 0,
                                  }}>
                                    {displayText}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center", gap: 16, flexShrink: 0 }}>
              <button
                onClick={markMatchReady}
                disabled={isSaving}
                style={{
                  padding: "12px 24px",
                  fontSize: "1rem",
                  backgroundColor: isSaving ? "#9ca3af" : "#10b981",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: isSaving ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                {isSaving ? "保存中..." : "確定して議論に進む"}
              </button>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  padding: "12px 24px",
                  fontSize: "1rem",
                  backgroundColor: "#6b7280",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {/* マップボタン */}
      <MapButton />
    </>
  );
}
