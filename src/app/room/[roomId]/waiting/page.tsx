// src/app/room/[roomId]/waiting/page.tsx
"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  ref,
  set,
  onValue,
  onDisconnect,
  off,
  get,
} from "firebase/database";
import { db, rtdb } from "../../../../../lib/firebase";
import { normalizeCategories } from '@/utils/normalizeCategories';

// Types
type CardInfo = { 
  id: string; 
  title: string; 
  src: string; 
  backSrc: string; 
};

type CardWithReason = CardInfo & { 
  reason?: string; 
};

type DraggedCard = {
  id: string;
  title: string;
  src: string;
  reason?: string;
  fromCategory?: string;
};

type CategoryType = 'veryWant' | 'want' | 'neutral' | 'dont' | 'veryDont';

type Categories = {
  veryWant: CardWithReason[];
  want: CardWithReason[];
  neutral: CardWithReason[];
  dont: CardWithReason[];
  veryDont: CardWithReason[];
};

// Reason icons for selection
const reasonIcons = [
  { emoji: "🍴", text: "ご当地グルメ" },
  { emoji: "🎢", text: "スリル" },
  { emoji: "🏃", text: "体験" },
  { emoji: "🛍", text: "買い物" },
  { emoji: "🖼", text: "建築・デザイン" },
  { emoji: "🏞", text: "景色" },
  { emoji: "⏱", text: "時間" },
  { emoji: "💰", text: "コスパ" },
  { emoji: "🤝", text: "友達と一緒に" },
  { emoji: "👪", text: "家族向け" },
  { emoji: "🧘", text: "リラックス" },
  { emoji: "❗", text: "その他" }
];

// ===============================
// Memoized Card Item (reduces re-renders per card)
// ===============================
type CardItemProps = {
  card: CardWithReason;
  category: CategoryType;
  interactionLocked: boolean;
  isActiveDragging: boolean;
  isPlacementCategory: boolean;
  onPick: (card: CardWithReason, fromCategory: CategoryType, x?: number, y?: number) => void;
  onOpenReason: (cardId: string, targetCategory: CategoryType, originalCategory?: CategoryType) => void;
};

const CardItem = React.memo(function CardItem({
  card,
  category,
  interactionLocked,
  isActiveDragging,
  isPlacementCategory,
  onPick,
  onOpenReason,
}: CardItemProps) {
  const [hovered, setHovered] = useState(false);
  const reasonIcon = reasonIcons.find(icon => icon.text === card.reason);
  const displayText = reasonIcon ? `${reasonIcon.emoji} ${card.reason}` : card.reason;
  const composedTransform = hovered ? 'translateY(-2px) scale(1.08)' : 'none';

  return (
    <div
      key={card.id}
      draggable={false}
      onClick={(e) => { e.stopPropagation(); onPick(card, category, e.clientX, e.clientY); }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '120px',
        cursor: interactionLocked ? 'not-allowed' : (isActiveDragging ? 'grabbing' : 'pointer'),
        transform: composedTransform,
        transition: 'transform 0.12s ease-out, box-shadow 0.12s ease-out',
        willChange: 'transform, box-shadow',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        WebkitTransform: composedTransform,
        WebkitTransformStyle: 'preserve-3d',
        transformStyle: 'preserve-3d',
        // Safari flicker対策: レイヤー固定
        contain: 'layout paint style',
        zIndex: hovered ? 2 : 1,
        boxShadow: hovered ? '0 6px 18px rgba(0,0,0,0.15)' : 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* カード名 */}
      <div
        style={{
          fontSize: '12px',
          fontWeight: '600',
          textAlign: 'center',
          marginBottom: '4px',
          color: '#374151',
          background: 'rgba(255, 255, 255, 0.9)',
          padding: '2px 4px',
          borderRadius: '4px',
          border: '1px solid #E5E7EB',
        }}
      >
        {card.title}
      </div>

      {/* カード画像 */}
      <div
        style={{
          border: '2px solid #D1D5DB',
          borderRadius: '8px',
          padding: '4px',
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
          marginBottom: '8px',
        }}
      >
        <img
          src={card.src}
          alt={card.title}
          draggable={false}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: '4px',
            display: 'block',
            filter: interactionLocked ? 'grayscale(30%)' : 'none',
            transform: 'translateZ(0)',
            WebkitBackfaceVisibility: 'hidden',
            backfaceVisibility: 'hidden',
            willChange: 'transform',
          }}
        />
      </div>

      {/* 理由表示 */}
      {card.reason && (
        <div
          style={{
            padding: '4px 8px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#FFFFFF',
            borderRadius: '4px',
            fontSize: '10px',
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '120px',
          }}
          title={displayText}
        >
          {displayText}
        </div>
      )}

      {/* 理由編集ボタン（配置カテゴリの時のみ） */}
      {isPlacementCategory && card.reason && !interactionLocked && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenReason(card.id, category, category);
          }}
          style={{
            marginTop: '6px',
            padding: '4px 6px',
            fontSize: '10px',
            borderRadius: '6px',
            border: '1px solid #93C5FD',
            backgroundColor: '#EFF6FF',
            color: '#1D4ED8',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#DBEAFE'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#EFF6FF'; }}
        >
          理由を編集
        </button>
      )}
    </div>
  );
}, (prev, next) => {
  // 再描画を最小化（関数propの同一性は無視）
  return (
    prev.card.id === next.card.id &&
    prev.card.reason === next.card.reason &&
    prev.category === next.category &&
    prev.interactionLocked === next.interactionLocked &&
    prev.isActiveDragging === next.isActiveDragging &&
    prev.isPlacementCategory === next.isPlacementCategory
  );
});

// ===============================
// Portal Ghost (renders under document.body to avoid stacking issues)
// ===============================
function PortalGhost({
  isDragging,
  draggedCard,
  dragPos,
  interactionLocked,
}: {
  isDragging: boolean;
  draggedCard: DraggedCard | null;
  dragPos: { x: number; y: number };
  interactionLocked: boolean;
}) {
  if (!isDragging || !draggedCard || typeof document === 'undefined') return null;
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: dragPos.x + 16,
        top: dragPos.y + 16,
        width: 120,
        pointerEvents: 'none',
        transform: 'translateZ(0)',
        opacity: 0.95,
        zIndex: 9999,
        filter: interactionLocked ? 'grayscale(30%)' : 'none',
      }}
    >
      <div style={{
        border: '2px solid rgba(59,130,246,0.85)',
        borderRadius: '8px',
        padding: '4px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.2)'
      }}>
        <img
          src={draggedCard.src}
          alt={draggedCard.title}
          style={{
            width: '100%',
            height: 'auto',
            borderRadius: '4px',
            display: 'block',
            opacity: 0.95,
            transform: 'translateZ(0)',
            WebkitBackfaceVisibility: 'hidden',
            backfaceVisibility: 'hidden',
          }}
        />
      </div>
    </div>,
    document.body
  );
}

export default function WaitingPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();
  
  // Hydration safety - avoid Date.now() during SSR
  const [isHydrated, setIsHydrated] = useState(false);
  const [clientUserId, setClientUserId] = useState<string>('');
  
  useEffect(() => {
    setIsHydrated(true);
    const userId = userName || `anonymous_${Date.now()}`;
    setClientUserId(userId);
    console.log("WaitingPage hydrated with:", { 
      roomId, 
      userId, 
      roomIdType: typeof roomId,
      roomIdValue: roomId
    });
  }, [userName, roomId]);
  
  const userId = isHydrated ? clientUserId : (userName || 'loading');

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  // State management
  const [planName, setPlanName] = useState("");
  const [categories, setCategories] = useState<Categories>({
    veryWant: [],
    want: [],
    neutral: [],
    dont: [],
    veryDont: [],
  });

  // Realtime states
  const [presenceData, setPresenceData] = useState<Record<string, boolean>>({});
  const [matchReadyData, setMatchReadyData] = useState<Record<string, boolean>>({});
  const [participants, setParticipants] = useState<Record<string,string>>({});
  const [selfReady, setSelfReady] = useState<boolean>(false); // participants/{userId}.isReady
  const [isSaving, setIsSaving] = useState<boolean>(false);   // 保存中スピナー

  // UI states
  const [draggedCard, setDraggedCard] = useState<DraggedCard | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    cardId: string;
    cardTitle: string;
    originalCategory: CategoryType;
    targetCategory: CategoryType;
  }>({
    isOpen: false,
    cardId: "",
    cardTitle: "",
    originalCategory: 'neutral',
    targetCategory: 'neutral',
  });
  const [reasonModal, setReasonModal] = useState<{
    isOpen: boolean;
    cardId: string;
    cardInfo: CardInfo | null;
    isFlipped: boolean;
    selectedIcon: number | null;
    customReason: string;
    targetCategory: CategoryType | null;
    originalCategory?: CategoryType | null;
  }>({
    isOpen: false,
    cardId: "",
    cardInfo: null,
    isFlipped: false,
    selectedIcon: null,
    customReason: "",
    targetCategory: null,
    originalCategory: null,
  });

  // Drag & Drop State
  const [isDragging, setIsDragging] = useState(false);
  const [dropZone, setDropZone] = useState<CategoryType | null>(null);
  const [interactionLocked, setInteractionLocked] = useState(false); // 合致率ボタン押下後にロック
  const [dragPos, setDragPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Drag ghost positioning (RAF throttled)
  const dragPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const scheduleDragPosUpdate = useCallback((x: number, y: number) => {
    dragPosRef.current = { x, y };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        setDragPos(dragPosRef.current);
        rafRef.current = null;
      });
    }
  }, []);

  // Debounced save timeout
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // All cards data
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

  // Computed values
  const matchReadyCount = Object.values(matchReadyData).filter(Boolean).length;
  
  // 最大参加者数の計算（オンラインユーザー基準）
  const totalParticipants = useMemo(() => {
    const count = Object.keys(participants).length;
    if (count > 0) return count;
    // fallback: matchReady のキー集合（初期化遅延時）
    const readyKeys = Object.keys(matchReadyData || {});
    return readyKeys.length || 0;
  }, [participants, matchReadyData]);
  
  // ユーザーの進捗計算（最適化）
  const userProgress = useMemo(() => {
    const veryWantCount = categories.veryWant.length;
    const veryDontCount = categories.veryDont.length;
    const reasonCount = [...categories.veryWant, ...categories.veryDont]
      .filter(c => c.reason && c.reason.trim()).length;
    const totalCategorized = Object.values(categories).reduce(
      (sum, cards) => sum + cards.length, 0
    );
    
    return {
      veryWantCount,
      veryDontCount,
      reasonCount,
      totalCategorized,
      hasReasons: reasonCount === (veryWantCount + veryDontCount) && (veryWantCount + veryDontCount) > 0,
      completionPercent: Math.round((totalCategorized / 40) * 100)
    };
  }, [categories]);

  // ===============================
  // RTDB Functions (Live State)
  // ===============================

  // RTDBに現在の状態を保存（リアルタイム用）
  const saveToRTDB = useCallback(async (updatedCategories?: Categories) => {
    if (!roomId || !userId || typeof roomId !== 'string') return;

    try {
      const categoriesToSave = updatedCategories || categories;
      const progressRef = ref(rtdb, `rooms/${roomId}/progress/${userId}`);
      
      const progressData = {
        userId,
        userName: userId,
        planName,
        categories: categoriesToSave,
        updatedAt: Date.now(),
      };

      await set(progressRef, progressData);
      console.log("waiting: Progress saved to RTDB:", progressData);
    } catch (error) {
      console.error("waiting: Error saving progress to RTDB:", error);
    }
  }, [roomId, userId, planName, categories]);

  // Debounced save to RTDB
  const debouncedSaveToRTDB = useCallback((updatedCategories?: Categories) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const timeout = setTimeout(() => {
      if (isMountedRef.current) {
        saveToRTDB(updatedCategories);
      }
    }, 500); // 500ms debounce (Safari ちらつき抑制)

    saveTimeoutRef.current = timeout;
  }, [saveToRTDB]);

  // プラン名が変更された時の処理
  useEffect(() => {
    if (planName && roomId && userId) {
      debouncedSaveToRTDB();
    }
  }, [planName, roomId, userId, debouncedSaveToRTDB]);

  // RTDBにログを書き込む
  const writeLogToRTDB = useCallback(async (logData: {
    action: string;
    cardId?: string;
    fromCategory?: string;
    toCategory?: string;
    reason?: string;
  }) => {
    if (!roomId || !userId || typeof roomId !== 'string') return;

    try {
      const logRef = ref(rtdb, `rooms/${roomId}/waitingLogs/${userId}/${Date.now()}`);
      await set(logRef, {
        userId,
        timestamp: Date.now(),
        ...logData,
      });
      console.log("waiting: Log written to RTDB:", logData);
    } catch (error) {
      console.error("waiting: Error writing log to RTDB:", error);
    }
  }, [roomId, userId]);

  // ===============================
  // Firestore Functions (Final Save)
  // ===============================

  // Firestoreに最終状態を保存
  const saveToFirestore = useCallback(async () => {
    if (!roomId || !userId || typeof roomId !== 'string') return;

    try {
      // RTDBから最新状態を取得
      const progressRef = ref(rtdb, `rooms/${roomId}/progress/${userId}`);
      const snapshot = await get(progressRef);
      
      if (!snapshot.exists()) {
        console.log("waiting: No RTDB data found, skipping Firestore save");
        return;
      }

      const rtdbData = snapshot.val();
      
      // Firestoreに保存
      const userPlanRef = doc(db, "rooms", roomId, "userPlans", userId);
      const finalData = {
        userId,
        userName: userId,
        planName: rtdbData.planName || planName,
        categories: {
          veryWant: rtdbData.categories.veryWant.map((card: CardWithReason) => ({
            cardId: card.id,
            reason: card.reason || "",
          })),
          want: rtdbData.categories.want.map((card: CardWithReason) => card.id),
          neutral: rtdbData.categories.neutral.map((card: CardWithReason) => card.id),
          dont: rtdbData.categories.dont.map((card: CardWithReason) => card.id),
          veryDont: rtdbData.categories.veryDont.map((card: CardWithReason) => ({
            cardId: card.id,
            reason: card.reason || "",
          })),
        },
        finalizedAt: serverTimestamp(),
      };

      await setDoc(userPlanRef, finalData);
      console.log("waiting: Final data saved to Firestore:", finalData);
    } catch (error) {
      console.error("waiting: Error saving to Firestore:", error);
    }
  }, [roomId, userId, planName]);

  // ===============================
  // Firebase Operations
  // ===============================

  // Mark user as ready for match result
  const markMatchReady = useCallback(async () => {
    console.log("markMatchReady called with:", { roomId, userId, typeOfRoomId: typeof roomId, isHydrated });
    
    if (!isHydrated || !roomId || !userId || typeof roomId !== 'string' || userId === 'loading' || roomId.trim() === '') {
      console.error("Invalid state for markMatchReady:", { roomId, userId, isHydrated });
      return;
    }

    try {
      if (selfReady || isSaving) return; // 二重防止
      setIsSaving(true);

  // 1) Firestore保存
      await saveToFirestore();

      // matchReady ドキュメントに保存
      await setDoc(doc(db, "rooms", roomId, "matchReady", userId), {
        userId,
        ready: true,
        updatedAt: serverTimestamp(),
      });
      // ボタン押下後は編集・DnDをロック
      setInteractionLocked(true);

      // 2) participants 用の userplan 保存
      const mapCategory = (arr: CardWithReason[]) =>
        arr.map(c => (c.reason ? { id: c.id, reason: c.reason } : { id: c.id }));

      // 2) finalSelections への保存（既存構造活用）
      const reasons: Record<string, string> = {};
      [...categories.veryWant, ...categories.veryDont].forEach(card => {
        if (card.reason) {
          reasons[card.id] = card.reason;
        }
      });

      const wantCards = [...categories.veryWant, ...categories.want].map(c => c.id);
      const dontCards = [...categories.veryDont, ...categories.dont].map(c => c.id);

      await setDoc(doc(db, "rooms", roomId, "finalSelections", userId), {
        user: userId,
        userId,
        userName: userId,
        planName: planName || "",
        
        // 新形式（詳細なカテゴリ）
        categories,
        
        // 従来形式（互換性のため）
        want: wantCards,
        dont: dontCards,
        reasons,
        
        updatedAt: serverTimestamp(),
        lastUpdated: new Date(),
        isReady: true,
        browser:
          typeof navigator !== "undefined" &&
          navigator.userAgent.includes("Safari") &&
          !navigator.userAgent.includes("Chrome")
            ? "Safari"
            : "Other",
        timestamp: Date.now(),
      });

      console.log("waiting: finalSelections doc successfully saved", { 
        userId, 
        wantCount: wantCards.length, 
        dontCount: dontCards.length,
        reasonCount: Object.keys(reasons).length
      });

      writeLogToRTDB({ action: "matchReady" });

    } catch (error) {
      console.error("waiting: Error marking match ready / saving participant:", error);
    } finally {
      setIsSaving(false);
    }
  }, [
    roomId,
    userId,
    saveToFirestore,
    writeLogToRTDB,
    categories,
    planName,
    selfReady,
    isSaving,
    isHydrated,
  ]);

  // ===============================
  // Effects - Data Subscriptions
  // ===============================

  // Initial mount setup
  useEffect(() => {
    isMountedRef.current = true;
    
    // 初期状態をRTDBに保存
    if (roomId && userId) {
      debouncedSaveToRTDB();
    }
    
    return () => {
      isMountedRef.current = false;
    };
  }, [roomId, userId, debouncedSaveToRTDB]);

  // Subscribe to user's finalSelections
  useEffect(() => {
    if (!roomId || !userId || typeof roomId !== 'string') return;

    const unsubscribe = onSnapshot(
      doc(db, "rooms", roomId, "finalSelections", userId),
      (doc) => {
        console.log("waiting: finalSelections document received:", doc.exists(), doc.data());
        
        if (doc.exists()) {
          const data = doc.data();
          console.log("waiting: Setting planName to:", data.planname || data.planName);
          const newPlanName = data.planname || data.planName || "";
          setPlanName(newPlanName);
          
          // プラン名が変更された時にRTDBも更新
          if (newPlanName !== planName) {
            debouncedSaveToRTDB();
          }
          
          // 新形式がある場合はそれを使用
          if (data.categories) {
            const normalized = normalizeCategories(data.categories);
            const mappedCategories: Categories = {
              veryWant: (normalized.verywant || [])
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full, reason: c.reason };
                })
                .filter(Boolean) as any,
              want: (normalized.want || [])
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full };
                })
                .filter(Boolean) as any,
              neutral: (normalized.neutral || [])
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full };
                })
                .filter(Boolean) as any,
              dont: (normalized.dont || [])
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full };
                })
                .filter(Boolean) as any,
              veryDont: (normalized.verydont || [])
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full, reason: c.reason };
                })
                .filter(Boolean) as any,
            };
            setCategories(mappedCategories);
            debouncedSaveToRTDB(mappedCategories);
          } else {
            // 旧形式→統一
            const convertedCategories: Categories = {
              veryWant: [], want: [], neutral: [], dont: [], veryDont: []
            };
            if (data.verywant) {
              data.verywant.forEach((cardId: string) => {
                const card = allCards.find(c => c.id === cardId);
                if (card) {
                  const reason = data.reasons?.[cardId] || '';
                  convertedCategories.veryWant.push({ ...card, reason });
                }
              });
            }
            if (data.verydont) {
              data.verydont.forEach((cardId: string) => {
                const card = allCards.find(c => c.id === cardId);
                if (card) {
                  const reason = data.reasons?.[cardId] || '';
                  convertedCategories.veryDont.push({ ...card, reason });
                }
              });
            }
            if (data.want) {
              data.want.forEach((cardId: string) => {
                const card = allCards.find(c => c.id === cardId);
                if (card && !data.verywant?.includes(cardId)) convertedCategories.want.push(card);
              });
            }
            if (data.neutral) {
              data.neutral.forEach((cardId: string) => {
                const card = allCards.find(c => c.id === cardId);
                if (card) convertedCategories.neutral.push(card);
              });
            }
            if (data.dont) {
              data.dont.forEach((cardId: string) => {
                const card = allCards.find(c => c.id === cardId);
                if (card && !data.verydont?.includes(cardId)) convertedCategories.dont.push(card);
              });
            }
            const normalizedOld = normalizeCategories({
              verywant: convertedCategories.veryWant,
              want: convertedCategories.want,
              neutral: convertedCategories.neutral,
              dont: convertedCategories.dont,
              verydont: convertedCategories.veryDont,
            });
            const finalCats: Categories = {
              veryWant: normalizedOld.verywant
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full, reason: c.reason };
                })
                .filter(Boolean) as any,
              want: normalizedOld.want
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full };
                })
                .filter(Boolean) as any,
              neutral: normalizedOld.neutral
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full };
                })
                .filter(Boolean) as any,
              dont: normalizedOld.dont
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full };
                })
                .filter(Boolean) as any,
              veryDont: normalizedOld.verydont
                .map(c => {
                  const full = allCards.find(ac => ac.id === c.id);
                  if (!full) return null;
                  return { ...full, reason: c.reason };
                })
                .filter(Boolean) as any,
            };
            setCategories(finalCats);
            debouncedSaveToRTDB(finalCats);
          }
        }
      }
    );

    return () => unsubscribe();
  }, [roomId, userId, allCards, debouncedSaveToRTDB]);

  // Subscribe to play1 logs to populate neutral cards
  useEffect(() => {
    if (!roomId || !userId || typeof roomId !== 'string') return;
    
    const q = query(
      collection(db, "rooms", roomId, "logs"),
      where("user", "==", userId)
    );
    
    const unsubscribe = onSnapshot(q, (snap) => {
      const logs = snap.docs.map(d => d.data());
      
      // 中性カテゴリを更新（既存の配置を保持）。最新のprevを使って重複や上書きを防ぐ
      setCategories(prev => {
        // 既に配置済みのカードID（最新）を取得
        const placedCardIds = new Set([
          ...prev.veryWant.map(c => c.id),
          ...prev.want.map(c => c.id),
          ...prev.dont.map(c => c.id),
          ...prev.veryDont.map(c => c.id),
        ]);

        // play1のログから中性カードを取得
        const nextNeutral: CardWithReason[] = [];
        logs.forEach((log: any) => {
          if (log.polarity === 2) { // 中性（どちらでもいい）
            const card = allCards.find(c => c.title === log.card);
            if (card && !placedCardIds.has(card.id)) {
              nextNeutral.push(card);
            }
          }
        });

        const newCategories = {
          ...prev,
          neutral: nextNeutral,
        };
        debouncedSaveToRTDB(newCategories);
        return newCategories;
      });
    });

    return () => unsubscribe();
  }, [roomId, userId, allCards, debouncedSaveToRTDB]);

  // Subscribe to presence data (RTDB)
  useEffect(() => {
    if (!roomId || !userId) return;

    const presenceRef = ref(rtdb, `presence/${roomId}`);
    const userPresenceRef = ref(rtdb, `presence/${roomId}/${userId}`);

    // Set user online
    set(userPresenceRef, true);

    // Set up disconnect handler
    onDisconnect(userPresenceRef).set(false);

    // Listen to all presence data
    onValue(presenceRef, (snapshot) => {
      const data = snapshot.val() || {};
      setPresenceData(data);
    });

    return () => {
      set(userPresenceRef, false);
      off(presenceRef);
    };
  }, [roomId, userId]);

  // Subscribe to matchReady data
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;

    const q = query(collection(db, "rooms", roomId, "matchReady"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const readyData: Record<string, boolean> = {};
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.ready) {
          readyData[data.userId] = true;
        }
      });
      setMatchReadyData(readyData);
    });

    return () => unsubscribe();
  }, [roomId]);

  // 参加者購読（rooms/{roomId}.participants を単一ソースとする）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, 'rooms', roomId as string);
    const unsub = onSnapshot(roomRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        const parts = (data.participants || {}) as Record<string,string>;
        setParticipants(parts);
      }
    });
    return () => unsub();
  }, [roomId]);

  // 自分の participants ドキュメント購読（isReady監視）
  useEffect(() => {
    if (!roomId || !userId || typeof roomId !== 'string') return;
    const selfRef = doc(db, 'rooms', roomId, 'participants', userId);
    const unsub = onSnapshot(selfRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.isReady) setSelfReady(true);
      }
    });
    return () => unsub();
  }, [roomId, userId]);

  // Navigate to match-result when all ready
  useEffect(() => {
    const matchReadyCount = Object.values(matchReadyData).filter(Boolean).length;
    // 参加者が1人以上いて、全員が準備完了した場合に遷移
    if (totalParticipants > 0 && matchReadyCount === totalParticipants) {
      router.push(`/room/${roomId}/match-result`);
    }
  }, [matchReadyData, totalParticipants, router, roomId]);

  // Cleanup and final save on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      
      // Clear timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      // Save final state to Firestore when leaving
      if (roomId && userId) {
        saveToFirestore();
      }
    };
  }, [saveToFirestore, roomId, userId]);

  // ===============================
  // Card Management
  // ===============================

  // Move card to category
  const moveCardToCategory = useCallback((cardId: string, targetCategory: CategoryType, reason?: string) => {
    const card = allCards.find(c => c.id === cardId);
    if (!card) return;

    // 元のカテゴリを特定
    let fromCategory: CategoryType | undefined;
    Object.entries(categories).forEach(([category, cards]) => {
      if (cards.some(c => c.id === cardId)) {
        fromCategory = category as CategoryType;
      }
    });

    const newCategories = { ...categories };
    
    // Remove card from all categories
    Object.keys(newCategories).forEach(category => {
      newCategories[category as CategoryType] = 
        newCategories[category as CategoryType].filter(c => c.id !== cardId);
    });
    
    // Add to target category
    const cardWithReason: CardWithReason = { ...card };
    if (reason) {
      cardWithReason.reason = reason;
    }
    newCategories[targetCategory].push(cardWithReason);
    
    // 重複回避: 特に行きたい/特に行きたくないに移動した場合、対応する基本カテゴリからも削除
    if (targetCategory === 'veryWant') {
      // 「特に行きたい」に移動した場合、「行きたい」からも削除
      newCategories.want = newCategories.want.filter(c => c.id !== cardId);
    } else if (targetCategory === 'veryDont') {
      // 「特に行きたくない」に移動した場合、「行きたくない」からも削除
      newCategories.dont = newCategories.dont.filter(c => c.id !== cardId);
    } else if (targetCategory === 'want') {
      // 「行きたい」に移動した場合、「特に行きたい」からも削除
      newCategories.veryWant = newCategories.veryWant.filter(c => c.id !== cardId);
    } else if (targetCategory === 'dont') {
      // 「行きたくない」に移動した場合、「特に行きたくない」からも削除
      newCategories.veryDont = newCategories.veryDont.filter(c => c.id !== cardId);
    }
    
    setCategories(newCategories);

    // RTDBにリアルタイムで保存
    debouncedSaveToRTDB(newCategories);

    // RTDBにログを書き込み
    writeLogToRTDB({
      action: 'moveCard',
      cardId,
      fromCategory,
      toCategory: targetCategory,
      reason,
    });
  }, [allCards, categories, debouncedSaveToRTDB, writeLogToRTDB]);

  // ===============================
  // Click-to-Drag (Pick & Drop) Handlers
  // ===============================

  const startPick = (card: CardWithReason, fromCategory: CategoryType, clientX?: number, clientY?: number) => {
    if (interactionLocked) return;
    setDraggedCard({
      id: card.id,
      title: card.title,
      src: card.src,
      reason: card.reason,
      fromCategory,
    });
    setIsDragging(true);
    if (clientX != null && clientY != null) {
      scheduleDragPosUpdate(clientX, clientY);
    }
  };

  const cancelPick = () => {
    setIsDragging(false);
    setDropZone(null);
    setDraggedCard(null);
  };

  const attemptDropToCategory = (targetCategory: CategoryType) => {
    if (!isDragging || !draggedCard) return;
    const id = draggedCard.id;
    let fromCategory = draggedCard.fromCategory as CategoryType | undefined;
    if (!fromCategory) {
      if (categories.veryWant.some(c => c.id === id)) fromCategory = 'veryWant';
      else if (categories.want.some(c => c.id === id)) fromCategory = 'want';
      else if (categories.neutral.some(c => c.id === id)) fromCategory = 'neutral';
      else if (categories.dont.some(c => c.id === id)) fromCategory = 'dont';
      else if (categories.veryDont.some(c => c.id === id)) fromCategory = 'veryDont';
    }

    if (fromCategory === targetCategory) {
      cancelPick();
      return;
    }

    const originalCard = Object.values(categories).flat().find(c => c.id === id);
    const hasReason = originalCard?.reason;

    // 理由付きカードを強いカテゴリから出す場合は確認
    if (hasReason && fromCategory && (fromCategory === 'veryWant' || fromCategory === 'veryDont')) {
      const title = draggedCard.title || originalCard?.title || '';
      setConfirmDialog({
        isOpen: true,
        cardId: id,
        cardTitle: title,
        originalCategory: fromCategory,
        targetCategory,
      });
      cancelPick();
      return;
    }

    // 強いカテゴリに入れる場合は理由モーダル
    if (targetCategory === 'veryWant' || targetCategory === 'veryDont') {
      openReasonModal(id, targetCategory, fromCategory as CategoryType);
    } else {
      moveCardToCategory(id, targetCategory);
    }

    cancelPick();
  };

  // 追従（クリックドラッグ時）
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      scheduleDragPosUpdate(e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPick();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
    };
  }, [isDragging, scheduleDragPosUpdate]);

  // (ネイティブDnDは廃止)

  // ===============================
  // Reason Modal Handlers
  // ===============================

  const openReasonModal = (cardId: string, targetCategory: CategoryType, originalCategory?: CategoryType) => {
    if (interactionLocked) return; // ロック中は開かない
    const cardInfo = allCards.find(c => c.id === cardId) || null;
    const existingCard = Object.values(categories).flat().find(c => c.id === cardId);
    const existingReason = existingCard?.reason;
    
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
      targetCategory,
      originalCategory,
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
      targetCategory: null,
      originalCategory: null,
    });
  };

  const confirmReason = () => {
    const { cardId, selectedIcon, customReason, targetCategory } = reasonModal;
    const finalReason = selectedIcon !== null ? reasonIcons[selectedIcon].text : customReason.trim();
    
    if (!finalReason) {
      alert("理由を選択または入力してください");
      return;
    }

    if (targetCategory) {
      moveCardToCategory(cardId, targetCategory, finalReason);
    }
    
    closeReasonModal();
  };

  const cancelReasonModal = () => {
    const { cardId, originalCategory } = reasonModal;
    
    // 元のカテゴリがある場合（カードの移動中の場合）は元のカテゴリに戻す
    if (originalCategory && cardId && originalCategory !== reasonModal.targetCategory) {
      console.log(`waiting: カードを元のカテゴリ ${originalCategory} に戻します`);
      moveCardToCategory(cardId, originalCategory);
    }
    
    closeReasonModal();
  };

  // ===============================
  // Utility Functions
  // ===============================

  const getCategoryName = (category: CategoryType) => {
    switch (category) {
      case 'veryWant': return '特に行きたい';
      case 'want': return '行きたい';
      case 'neutral': return 'どちらでもいい';
      case 'dont': return '行きたくない';
      case 'veryDont': return '特に行きたくない';
      default: return '';
    }
  };

  // ===============================
  // Components
  // ===============================

  const CategorySection = ({ category, cards }: { category: CategoryType; cards: CardWithReason[] }) => {
    // 表示順を card 番号の昇順に統一
    const sortedCards = [...cards].sort((a, b) => parseInt(a.id.replace('card',''),10) - parseInt(b.id.replace('card',''),10));
    // Safariでの点滅(flicker)対策: transformを直接DOM操作で上書きせず、状態に基づき一元的に指定
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    const getCategoryStyle = (category: CategoryType) => {
      switch (category) {
        case 'veryWant': return {
          border: '2px solid #EF4444',
          backgroundColor: '#FEF2F2',
        };
        case 'want': return {
          border: '2px solid #EC4899',
          backgroundColor: '#FDF2F8',
        };
        case 'neutral': return {
          border: '2px solid #6B7280',
          backgroundColor: '#F9FAFB',
        };
        case 'dont': return {
          border: '2px solid #06B6D4',
          backgroundColor: '#F0F9FF',
        };
        case 'veryDont': return {
          border: '2px solid #3B82F6',
          backgroundColor: '#EFF6FF',
        };
        default: return {
          border: '2px solid #D1D5DB',
          backgroundColor: '#F9FAFB',
        };
      }
    };

    const isPlacementCategory = category === 'veryWant' || category === 'veryDont';
    const categoryStyle = getCategoryStyle(category);

    return (
      <div style={{
        ...categoryStyle,
        borderRadius: '12px',
        padding: '20px',
        minHeight: '200px',
        width: '100%',
        marginBottom: '20px',
        transition: 'all 0.2s ease',
        transform: dropZone === category ? 'scale(1.02)' : 'scale(1)',
        boxShadow: dropZone === category 
          ? '0 8px 25px rgba(0, 0, 0, 0.15)' 
          : '0 2px 10px rgba(0, 0, 0, 0.1)',
        border: dropZone === category 
          ? '3px solid #3B82F6' 
          : categoryStyle.border,
      }}>
        <h3 style={{
          textAlign: 'center',
          fontWeight: 'bold',
          marginBottom: '16px',
          fontSize: '20px',
          color: '#1F2937',
        }}>
          {getCategoryName(category)}
        </h3>
        
        {/* カード枠エリア */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            minHeight: '160px',
            justifyContent: 'flex-start',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
          onClick={() => attemptDropToCategory(category)}
        >
          {/* 一番左の配置可能枠（常に表示） */}
          {(
            <div
              style={{
                border: '2px dashed #9CA3AF',
                borderRadius: '8px',
                width: '120px',
                height: '160px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6B7280',
                fontSize: '14px',
                fontWeight: '600',
                backgroundColor: 'rgba(249, 250, 251, 0.8)',
                opacity: interactionLocked ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: '18px', marginBottom: '4px' }}>
                ⭕
              </div>
              <div>
                配置可能
              </div>
            </div>
          )}
          
          {/* カード表示 */}
          {sortedCards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              category={category}
              interactionLocked={interactionLocked}
              isActiveDragging={isDragging && draggedCard?.id === card.id}
              isPlacementCategory={isPlacementCategory}
              onPick={startPick}
              onOpenReason={openReasonModal}
            />
          ))}
        </div>
      </div>
    );
  };

  // ===============================
  // Render
  // ===============================

  // Show loading state during hydration
  if (!isHydrated) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#F3F4F6',
        padding: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ fontSize: '24px', color: '#1F2937' }}>読み込み中...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
  backgroundColor: isDragging ? '#F0F9FF' : '#F8FAFC',
      padding: '16px',
      transition: 'background-color 0.2s ease',
    }}
    >
      <div style={{
        maxWidth: '1280px',
        margin: '0 auto',
      }}>
        {/* Header */}
        <div style={{
          textAlign: 'center',
          marginBottom: '32px',
        }}>
          <h1 style={{
            fontSize: '48px',
            fontWeight: 'bold',
            color: '#1F2937',
            marginBottom: '8px',
          }}>
            プラン調整
          </h1>
          
          {/* ユーザー名表示 */}
          <h2 style={{
            fontSize: '32px',
            fontWeight: '600',
            color: '#2563EB',
            marginBottom: '16px',
          }}>
            ユーザー名：{userId}
          </h2>
          
          {/* プラン名表示・編集 */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '24px',
          }}>
            <span style={{
              fontSize: '18px',
              color: '#374151',
              fontWeight: '600',
            }}>
              プラン名:
            </span>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="プラン名を入力してください"
              style={{
                fontSize: '20px',
                color: '#2563EB',
                backgroundColor: '#FFFFFF',
                border: '2px solid #93C5FD',
                outline: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                minWidth: '256px',
                pointerEvents: interactionLocked ? 'none' : 'auto',
                opacity: interactionLocked ? 0.6 : 1,
              }}
              onFocus={(e) => {
                e.target.style.border = '2px solid #3B82F6';
              }}
              onBlur={(e) => {
                e.target.style.border = '2px solid #93C5FD';
                debouncedSaveToRTDB();
              }}
              disabled={interactionLocked}
            />
          </div>
        </div>

        {/* Category sections - 縦配置（改善版） */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          marginBottom: '40px',
          width: '100%',
          maxWidth: '1000px',
          margin: '0 auto 40px auto',
        }}>
          <CategorySection category="veryWant" cards={categories.veryWant} />
          <CategorySection category="want" cards={categories.want} />
          <CategorySection category="neutral" cards={categories.neutral} />
          <CategorySection category="dont" cards={categories.dont} />
          <CategorySection category="veryDont" cards={categories.veryDont} />
        </div>

        {/* Action button */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={markMatchReady}
            disabled={selfReady || matchReadyData[userId] || !userProgress.hasReasons || isSaving}
            style={{
              padding: '16px 32px',
              borderRadius: '8px',
              fontWeight: 'bold',
              fontSize: '20px',
              border: 'none',
              cursor: (selfReady || matchReadyData[userId] || !userProgress.hasReasons || isSaving) ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
              backgroundColor: (selfReady || matchReadyData[userId])
                ? '#9CA3AF'
                : !userProgress.hasReasons
                  ? '#EAB308'
                  : '#2563EB',
              color: '#FFFFFF',
            }}
            onMouseEnter={(e) => {
              if (!(selfReady || matchReadyData[userId] || isSaving) && userProgress.hasReasons) {
                e.currentTarget.style.backgroundColor = '#1D4ED8';
              }
            }}
            onMouseLeave={(e) => {
              if (!(selfReady || matchReadyData[userId] || isSaving) && userProgress.hasReasons) {
                e.currentTarget.style.backgroundColor = '#2563EB';
              }
            }}
          >
            {selfReady || matchReadyData[userId]
              ? '準備完了済み'
              : isSaving
                ? '保存中...'
                : !userProgress.hasReasons
      ? '理由を入力してください'
                  : `合致率を見る (${matchReadyCount}/${totalParticipants})`}
          </button>
          
          {/* 進行状況表示 */}
          {matchReadyCount > 0 && (
            <p
              style={{
                marginTop: '8px',
                fontSize: '14px',
                color: matchReadyCount === totalParticipants ? '#10B981' : '#6B7280',
                fontWeight: matchReadyCount === totalParticipants ? 'bold' : 'normal',
              }}
            >
              {matchReadyCount === totalParticipants
                ? '全員準備完了！まもなく合致率画面に移動します...'
                : `${matchReadyCount} / ${totalParticipants} 人が準備完了しました`}
            </p>
          )}
          {matchReadyCount > 0 && matchReadyCount < totalParticipants && (
            <p style={{
              marginTop: '4px',
              fontSize: '12px',
              color: '#9CA3AF',
            }}>
              他の参加者を待っています...
            </p>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfirmDialog(prev => ({ ...prev, isOpen: false }));
            }
          }}
        >
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '448px',
            width: '100%',
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              textAlign: 'center',
              marginBottom: '16px',
              color: '#DC2626',
            }}>
              理由付きカードの移動確認
            </h3>
            <div style={{
              textAlign: 'center',
              marginBottom: '24px',
              padding: '16px',
              backgroundColor: '#FEF2F2',
              borderRadius: '8px',
              border: '1px solid #FECACA',
            }}>
              <p style={{
                margin: '0 0 8px 0',
                fontWeight: '600',
                color: '#1F2937',
              }}>
                「{confirmDialog.cardTitle}」
              </p>
              <p style={{
                margin: '0 0 8px 0',
                fontSize: '14px',
                color: '#DC2626',
              }}>
                このカードには理由が設定されています。
              </p>
              <p style={{
                margin: '0',
                fontSize: '14px',
                color: '#6B7280',
              }}>
                移動すると理由が削除されます。よろしいですか？
              </p>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
            }}>
              <button
                onClick={() => {
                  moveCardToCategory(confirmDialog.cardId, confirmDialog.targetCategory);
                  setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#DC2626',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#B91C1C';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#DC2626';
                }}
              >
                理由を削除して移動
              </button>
              <button
                onClick={() => {
                  setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#6B7280',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#4B5563';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#6B7280';
                }}
              >
                キャンセル
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Reason Modal */}
      {reasonModal.isOpen && reasonModal.cardInfo && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '16px',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeReasonModal();
          }}
        >
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '896px',
            width: '100%',
            maxHeight: '600px',
            overflowY: 'auto',
          }}>
            <h3 style={{
              fontSize: '20px',
              fontWeight: 'bold',
              textAlign: 'center',
              marginBottom: '24px',
            }}>
              このカードを選んだ理由を選択・入力してください
            </h3>

            <div style={{
              display: 'flex',
              gap: '24px',
            }}>
              {/* Card display */}
              <div style={{
                flexShrink: 0,
                textAlign: 'center',
              }}>
                <div
                  style={{
                    width: '192px',
                    height: '288px',
                    cursor: 'pointer',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
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
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <p style={{
                  marginTop: '12px',
                  fontWeight: '600',
                }}>
                  {reasonModal.cardInfo.title}
                </p>
              </div>

              {/* Reason selection */}
              <div style={{ flex: 1 }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)', // 4列に変更してplay2と統一
                  gap: '12px',
                  marginBottom: '24px',
                }}>
                  {reasonIcons.map((icon, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setReasonModal(prev => ({ 
                          ...prev, 
                          selectedIcon: index,
                          customReason: ""
                        }));
                      }}
                      style={{
                        padding: '12px 8px',
                        border: reasonModal.selectedIcon === index 
                          ? '3px solid #3B82F6' 
                          : '2px solid #E5E7EB',
                        borderRadius: '12px',
                        backgroundColor: reasonModal.selectedIcon === index 
                          ? '#EFF6FF' 
                          : '#FFFFFF',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        minHeight: '80px',
                      }}
                      onMouseEnter={(e) => {
                        if (reasonModal.selectedIcon !== index) {
                          e.currentTarget.style.borderColor = '#93C5FD';
                          e.currentTarget.style.backgroundColor = '#F8FAFC';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (reasonModal.selectedIcon !== index) {
                          e.currentTarget.style.borderColor = '#E5E7EB';
                          e.currentTarget.style.backgroundColor = '#FFFFFF';
                        }
                      }}
                    >
                      <div style={{ fontSize: '28px', marginBottom: '4px' }}>{icon.emoji}</div>
                      <div style={{ 
                        fontSize: '11px', 
                        fontWeight: '500',
                        color: '#374151',
                        textAlign: 'center',
                        lineHeight: '1.2',
                      }}>
                        {icon.text}
                      </div>
                    </button>
                  ))}
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '8px',
                  }}>
                    理由を詳しく記入（任意）
                  </label>
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
                        ? `「${reasonIcons[reasonModal.selectedIcon].text}」の詳細理由があれば記入してください`
                        : "選択理由を記入してください"
                    }
                    style={{
                      width: '100%',
                      height: '80px',
                      padding: '12px',
                      border: '2px solid #E5E7EB',
                      borderRadius: '8px',
                      resize: 'none',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                    onFocus={(e) => {
                      e.target.style.borderColor = '#3B82F6';
                    }}
                    onBlur={(e) => {
                      e.target.style.borderColor = '#E5E7EB';
                    }}
                  />
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              marginTop: '24px',
            }}>
              <button
                onClick={confirmReason}
                style={{
                  padding: '12px 32px',
                  backgroundColor: '#2563EB',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '16px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#1D4ED8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#2563EB';
                }}
              >
                決定
              </button>
              <button
                onClick={cancelReasonModal}
                style={{
                  padding: '12px 32px',
                  backgroundColor: '#6B7280',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '16px',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#4B5563';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#6B7280';
                }}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      <PortalGhost isDragging={isDragging} draggedCard={draggedCard} dragPos={dragPos} interactionLocked={interactionLocked} />
    </div>
  );
}
