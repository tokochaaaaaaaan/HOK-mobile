"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { 
  agreementForCard,
  agreementOverall,
  convertSelectionsToMatrix
} from "../../../../utils/agreement-calculator";
import { normalizeCategories } from "../../../../utils/normalizeCategories";

type UserSelection = {
  user: string;
  userId: string;
  userName: string;
  planName?: string;
  categories: {
    veryWant: Array<{id: string; reason?: string}>;
    want: Array<{id: string; reason?: string}>;
    neutral: Array<{id: string; reason?: string}>;
    dont: Array<{id: string; reason?: string}>;
    veryDont: Array<{id: string; reason?: string}>;
  };
};

type CardDiscussionStatus = {
  [cardId: string]: {
    isDiscussed: boolean;
    participants: string[];
  };
};

// カード情報の定義
const allCards = Array.from({ length: 40 }, (_, i) => {
  const idx = i + 1;
  return {
    id: `card${idx}`,
    title: `カード${idx}`,
    src: `/pngs/USJ_${idx}_surface-1.png`,
    backSrc: `/pngs/back/USJ_${idx}_back-1.png`,
  };
});

// カテゴリーの表示名と色
const categoryInfo = {
  veryWant: { name: '特に行きたい', color: 'bg-red-500', textColor: 'text-white' },
  want: { name: '行きたい', color: 'bg-orange-400', textColor: 'text-white' },
  neutral: { name: 'どちらでもいい', color: 'bg-gray-400', textColor: 'text-white' },
  dont: { name: '行きたくない', color: 'bg-blue-400', textColor: 'text-white' },
  veryDont: { name: '特に行きたくない', color: 'bg-purple-500', textColor: 'text-white' },
};

export default function Play3Page() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();
  
  // ブラウザの戻るボタンを無効化
  usePreventBack();

  // State
  const [userSelections, setUserSelections] = useState<UserSelection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overallAgreement, setOverallAgreement] = useState<number>(0);
  const [cardAgreements, setCardAgreements] = useState<{cardId: string; agreement: number; title: string}[]>([]);
  const [discussionStatus, setDiscussionStatus] = useState<CardDiscussionStatus>({});
  // DnD 用のローカル状態（Firestoreの go/no に基づいて計算）
  const [poolIds, setPoolIds] = useState<string[]>(allCards.map(c => c.id));
  const [goIds, setGoIds] = useState<string[]>([]);
  const [notGoIds, setNotGoIds] = useState<string[]>([]);
  const [hoverTarget, setHoverTarget] = useState<"go" | "notgo" | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showNeutralBucket, setShowNeutralBucket] = useState(false); // どちらでもいい一覧モーダル
  // 統一カードサイズ
  const CARD_WIDTH = 240;
  const CARD_HEIGHT = 160;
  // プールとカスタム水平スクロールバー用
  const poolScrollRef = useRef<HTMLDivElement | null>(null);
  const poolRowRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dragging: boolean; startX: number; startScrollLeft: number; factor: number }>({ dragging: false, startX: 0, startScrollLeft: 0, factor: 1 });
  const scrollRafRef = useRef(false); // スクロール中の rAF スロットル
  // 仮想化/表示用定数（トップカードレーン）
  const VISIBLE_COUNT = 8; // 常時表示したい枚数
  const CARD_GAP = 10; // カード間隔
  const LANE_LEFT_PADDING = 12; // 左パディング（スクロール計算で補正）
  const laneWidth = VISIBLE_COUNT * CARD_WIDTH + CARD_GAP * (VISIBLE_COUNT - 1) + LANE_LEFT_PADDING;
  const [activeCardIndex, setActiveCardIndex] = useState(0); // （未使用）中央ハイライト無効化後も Hook 順序維持用
  const [scrollMetrics, setScrollMetrics] = useState({ content: 0, viewport: 0, scrollLeft: 0, track: 0 });
  const updateScrollMetrics = () => {
    const wrap = poolScrollRef.current;
    if (!wrap) return;
    setScrollMetrics(m => ({
      content: wrap.scrollWidth,
      viewport: wrap.clientWidth,
      scrollLeft: wrap.scrollLeft,
      track: trackRef.current?.clientWidth || m.track
    }));
    // 中央カード判定
  // 中央ハイライト機能は削除（揺れ・不要なエフェクト回避）
  };
  useEffect(() => {
    updateScrollMetrics();
  const ro = new ResizeObserver(updateScrollMetrics);
    if (poolScrollRef.current) ro.observe(poolScrollRef.current);
    if (poolRowRef.current) ro.observe(poolRowRef.current);
    if (trackRef.current) ro.observe(trackRef.current);
    // 長押しテキスト選択の抑制: スクロールレーン内の pointer down で選択解除
    const clearSelection = (e: Event) => {
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    };
    const lane = poolScrollRef.current;
    lane?.addEventListener('mousedown', clearSelection);
    lane?.addEventListener('touchstart', clearSelection, { passive: true });
    return () => ro.disconnect();
  }, [poolIds.length]);
  // ドラッグイベント
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const wrap = poolScrollRef.current;
      if (!wrap) return;
      const delta = e.clientX - dragRef.current.startX;
      const newScroll = dragRef.current.startScrollLeft + delta * dragRef.current.factor;
      const max = wrap.scrollWidth - wrap.clientWidth;
      wrap.scrollLeft = Math.min(Math.max(newScroll, 0), max);
      updateScrollMetrics();
    };
    const end = () => { dragRef.current.dragging = false; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', end);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', end); };
  }, []);
  // selectstart を全体で止めてドラッグ時青反転を防ぐ（モーダル内は後で上書き）
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); };
    document.addEventListener('selectstart', handler, { passive: false });
    return () => document.removeEventListener('selectstart', handler);
  }, []);

  // finalSelections を購読し、全参加者の最終データを取得
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qSel = query(collection(db, 'rooms', roomId, 'finalSelections'));
    const unsub = onSnapshot(qSel, snap => {
      const selections: UserSelection[] = [];
      snap.docs.forEach(d => {
        const data: any = d.data();
        if (data?.categories) {
          // 新形式
          const normalized = normalizeCategories(data.categories);
          selections.push({
            user: data.user || data.userId || data.userName || d.id,
            userId: data.userId || data.user || data.userName || d.id,
            userName: data.userName || data.user || data.userId || d.id,
            planName: data.planName || data.planname || '',
            categories: {
              veryWant: (normalized.verywant || []).map((c: any) => ({ id: c.id, reason: c.reason })),
              want: (normalized.want || []).map((c: any) => ({ id: c.id })),
              neutral: (normalized.neutral || []).map((c: any) => ({ id: c.id })),
              dont: (normalized.dont || []).map((c: any) => ({ id: c.id })),
              veryDont: (normalized.verydont || []).map((c: any) => ({ id: c.id, reason: c.reason })),
            }
          });
        } else {
          // 旧形式
          const normalized = normalizeCategories({
            verywant: (data.verywant || []).map((id: string) => ({ id })),
            want: (data.want || []).map((id: string) => ({ id })),
            neutral: (data.neutral || []).map((id: string) => ({ id })),
            dont: (data.dont || []).map((id: string) => ({ id })),
            verydont: (data.verydont || []).map((id: string) => ({ id })),
          });
          selections.push({
            user: data.user || data.userId || d.id,
            userId: data.userId || data.user || d.id,
            userName: data.userName || data.user || d.id,
            planName: data.planName || data.planname || '',
            categories: {
              veryWant: (normalized.verywant || []).map((c: any) => ({ id: c.id })),
              want: (normalized.want || []).map((c: any) => ({ id: c.id })),
              neutral: (normalized.neutral || []).map((c: any) => ({ id: c.id })),
              dont: (normalized.dont || []).map((c: any) => ({ id: c.id })),
              veryDont: (normalized.verydont || []).map((c: any) => ({ id: c.id })),
            }
          });
        }
      });
      setUserSelections(selections);
      setIsLoading(false);
    });
    return () => unsub();
  }, [roomId]);

  // Load discussion status
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;

    const statusRef = doc(db, "rooms", roomId, "meta", "discussionStatus");
    const unsubscribe = onSnapshot(statusRef, (doc) => {
      if (doc.exists()) {
        setDiscussionStatus(doc.data() as CardDiscussionStatus);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // Calculate agreement rates when selections are loaded
  useEffect(() => {
    if (userSelections.length === 0) return;

    // Convert selections to rating matrix
    const ratingMatrix = convertSelectionsToMatrix(userSelections, 40);
    
    // Calculate overall agreement
    const overall = agreementOverall(ratingMatrix);
    setOverallAgreement(overall);

    // Calculate agreement for each card
    const cardResults = ratingMatrix.map((ratings, index) => ({
      cardId: `card${index + 1}`,
      title: `カード${index + 1}`,
      agreement: agreementForCard(ratings),
    }));
    
    setCardAgreements(cardResults);
  }, [userSelections]);

  // Get users who selected a specific card in non-neutral categories
  const getNonNeutralUsers = (cardId: string): string[] => {
    const nonNeutralUsers: string[] = [];
    
    userSelections.forEach(selection => {
      const { categories } = selection;
      const isNonNeutral = 
        categories.veryWant.some(card => card.id === cardId) ||
        categories.want.some(card => card.id === cardId) ||
        categories.dont.some(card => card.id === cardId) ||
        categories.veryDont.some(card => card.id === cardId);
      
      if (isNonNeutral) {
        nonNeutralUsers.push(selection.userId);
      }
    });
    
    return nonNeutralUsers;
  };

  // Check if discussion button should be enabled for a card
  const canDiscussCard = (cardId: string): boolean => {
    const nonNeutralUsers = getNonNeutralUsers(cardId);
    const discussedCard = discussionStatus[cardId];
    
    // If already discussed, disable button
    if (discussedCard && discussedCard.isDiscussed) {
      return false;
    }
    
    // If no non-neutral users, disable
    if (nonNeutralUsers.length === 0) {
      return false;
    }
    
    return true;
  };

  // Handle discussion button click
  const handleDiscussCard = async (cardId: string) => {
    if (!roomId || typeof roomId !== 'string' || !userName) return;
    
    const nonNeutralUsers = getNonNeutralUsers(cardId);
    
    // Check if all non-neutral users are ready to discuss
    const currentParticipants = discussionStatus[cardId]?.participants || [];
    const updatedParticipants = [...new Set([...currentParticipants, userName])];
    
    // Update discussion status
    const statusRef = doc(db, "rooms", roomId, "meta", "discussionStatus");
    const newStatus = {
      ...discussionStatus,
      [cardId]: {
        isDiscussed: updatedParticipants.length >= nonNeutralUsers.length,
        participants: updatedParticipants,
      }
    };
    
    await setDoc(statusRef, newStatus, { merge: true });
    
    // If all non-neutral users are ready, go to discussion
    if (updatedParticipants.length >= nonNeutralUsers.length) {
      router.push(`/room/${roomId}/discussion/${cardId}`);
    }
  };

  // Get user's selection for a specific card
  const getUserSelectionForCard = (cardId: string, userId: string) => {
    const user = userSelections.find(s => s.userId === userId);
    if (!user) return null;
    
    for (const [category, cards] of Object.entries(user.categories)) {
      if (cards.some((card: {id: string}) => card.id === cardId)) {
        const cardData = cards.find((card: {id: string}) => card.id === cardId);
        return {
          category,
          reason: cardData?.reason || ''
        };
      }
    }
    return { category: 'neutral', reason: '' };
  };

  // Firestore: go/no を購読
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const q = query(collection(db, 'rooms', roomId, 'goNo'));
    const unsub = onSnapshot(q, (snap) => {
      const go: string[] = [];
      const no: string[] = [];
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.status === 'go') go.push(d.id);
        else if (data?.status === 'no') no.push(d.id);
      });
      setGoIds(go);
      setNotGoIds(no);
      const decided = new Set([...go, ...no]);
      const all = allCards.map((c) => c.id);
      setPoolIds(all.filter((id) => !decided.has(id)));
    });
    return () => unsub();
  }, [roomId]);

  // --- Drag & Drop helpers & 決定処理 ---
  const onDragStart = (e: React.DragEvent<HTMLDivElement>, cardId: string) => {
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const classifyCard = async (cardId: string, status: 'go' | 'no') => {
    if (!roomId || typeof roomId !== 'string') return;
    const ref = doc(db, 'rooms', roomId, 'goNo', cardId);
    await setDoc(ref, {
      status,
      decidedBy: userName || 'unknown',
      decidedAt: serverTimestamp(),
    }, { merge: true });
  };
  const onDropTo = (target: 'go' | 'notgo') => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    if (target === 'go') classifyCard(id, 'go');
    if (target === 'notgo') classifyCard(id, 'no');
    setHoverTarget(null); // 見た目のハイライトを消す（実際の反映は snapshot で）
  };
  const getCardInfo = (id: string) => allCards.find(c => c.id === id);
  // 合致率マップ（cardId -> agreement%）をメモ化
  const agreementMap = useMemo(() => {
    const map = new Map<string, number>();
    cardAgreements.forEach(c => map.set(c.cardId, c.agreement));
    return map;
  }, [cardAgreements]);
  // 全員 "neutral" のみ（他カテゴリに誰も入れていない）カード抽出
  const neutralOnlyIds = useMemo(() => {
    if (!userSelections.length) return [] as string[];
    return poolIds.filter(id => {
      return userSelections.every(sel => {
        const { veryWant, want, dont, veryDont, neutral } = sel.categories;
        const inPositive = veryWant.some(c=>c.id===id) || want.some(c=>c.id===id);
        const inNegative = dont.some(c=>c.id===id) || veryDont.some(c=>c.id===id);
        if (inPositive || inNegative) return false;
        return neutral.some(c=>c.id===id); // 全員 neutral に含めている
      });
    });
  }, [poolIds, userSelections]);
  // 並び順（非中立優先→合致率降順）をメモ化: isLoading の early return より前に置いて Hook 順序を固定
  const sortedPoolIds = useMemo(() => {
    return [...poolIds].sort((a, b) => {
      const aNon = getNonNeutralUsers(a).length > 0 ? 1 : 0;
      const bNon = getNonNeutralUsers(b).length > 0 ? 1 : 0;
      if (aNon !== bNon) return bNon - aNon;
      const aAg = agreementMap.get(a) ?? 0;
      const bAg = agreementMap.get(b) ?? 0;
      return bAg - aAg;
    });
  }, [poolIds, userSelections, agreementMap]);
  const laneIds = useMemo(() => {
    const filtered = sortedPoolIds.filter(id => !neutralOnlyIds.includes(id));
    return neutralOnlyIds.length > 0 ? [...filtered, '__NEUTRAL_BUCKET__'] : filtered;
  }, [sortedPoolIds, neutralOnlyIds]);
  const renderCardToken = (id: string, opts?: { draggable?: boolean; onClick?: () => void }) => {
    const info = getCardInfo(id);
    if (!info) return null;
    const clickable = opts?.onClick;
    const draggable = opts?.draggable ?? false;
  const ag = agreementMap.get(id) ?? 0;
    return (
      <div
        key={id}
        draggable={draggable}
        style={{
          width: CARD_WIDTH,
          border: '1px solid #e5e7eb',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 4px 10px rgba(2,6,23,0.06)',
          cursor: 'default',
          userSelect: 'none',
          transition: 'transform .15s ease, box-shadow .15s ease',
          pointerEvents: 'none',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 18px rgba(2,6,23,0.12)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 10px rgba(2,6,23,0.06)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}
      >
        <div
          draggable={draggable}
          onDragStart={draggable ? (e) => onDragStart(e as any, id) : undefined}
          onClick={clickable}
          style={{ width: '100%', height: CARD_HEIGHT, background: '#fff', pointerEvents: 'auto', cursor: clickable ? 'pointer' : (draggable ? 'grab' : 'default') }}
        >
          <img src={info.src} alt="card" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>
        <div style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, fontSize: 12, color: '#334155', pointerEvents: 'none' }}>
          合致 {ag.toFixed(0)}%
        </div>
      </div>
    );
  };

  // 自動振り分けは廃止（最初は go/no は空）。Firestoreの goNo を唯一のソースとする。

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #eef2ff 0%, #f0f9ff 40%, #fdf2f8 100%)',
          color: '#0f172a',
          fontSize: 20,
        }}
      >
        読み込み中...
      </div>
    );
  }

  const noData = !isLoading && userSelections.length === 0;
  const participantNames = userSelections.map(u => u.userName || u.userId).join('・');
  // カテゴリ名と色（インラインスタイル用）
  const categoryName: Record<string, string> = {
    veryWant: '特に行きたい',
    want: '行きたい',
    neutral: 'どちらでもいい',
    dont: '行きたくない',
    veryDont: '特に行きたくない',
  };
  const categoryChipStyle: Record<string, {bg: string; text: string; border: string}> = {
    // ご要望の配色: 特に行きたい=赤, 行きたい=ピンク, どちらでもいい=灰, 行きたくない=水色, 特に行きたくない=青
    veryWant: { bg: '#fecaca', text: '#7f1d1d', border: '#fca5a5' },      // 赤系（薄め背景）
    want: { bg: '#fce7f3', text: '#9d174d', border: '#fbcfe8' },           // ピンク
    neutral: { bg: '#e5e7eb', text: '#374151', border: '#d1d5db' },        // 灰色
    dont: { bg: '#bae6fd', text: '#0c4a6e', border: '#93c5fd' },           // 水色
    veryDont: { bg: '#93c5fd', text: '#1e3a8a', border: '#60a5fa' },       // 青
  };



  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#ffffff',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        MozUserSelect: 'none',
        msUserSelect: 'none'
      }}
    >
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 16px 40px' }}>
        {/* Summary card */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              margin: '0 auto',
              maxWidth: 760,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(248,250,252,0.9) 60%, rgba(255,255,255,0.95) 100%)',
              border: '1px solid #e2e8f0',
              backdropFilter: 'blur(8px)',
              borderRadius: 28,
              boxShadow: '0 12px 40px -12px rgba(15,23,42,0.25), 0 0 0 1px rgba(255,255,255,0.4) inset',
              padding: '20px 26px',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontSize: 'clamp(22px, 4.5vw, 30px)',
              fontWeight: 800,
              color: '#0f172a',
              letterSpacing: '0.2px',
              marginBottom: 8,
            }}>みんなの合致率</div>
            <div style={{
              fontSize: 'clamp(44px, 11vw, 64px)',
              fontWeight: 900,
              backgroundImage: 'linear-gradient(135deg, #0ea5e9, #2563eb, #4f46e5)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: '0 4px 16px rgba(2,6,23,0.18)'
            }}>{overallAgreement.toFixed(0)}%</div>
            <div style={{ marginTop: 8, color: '#475569', fontSize: 16 }}>
              {overallAgreement >= 80 ? '👍 素晴らしい相性！' : overallAgreement >= 60 ? '👍 良い相性！' : '🤝 話し合いで近づけよう！'}
            </div>
            <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 13 }}>
              参加者: {participantNames || '—'}
            </div>
          </div>
        </div>

        {/* 上段: プール（横一列スクロール 8枚ウィンドウ + カスタムスクロールバー） */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ position: 'relative' }}>
            <div
              ref={poolScrollRef}
              onScroll={() => {
                if (scrollRafRef.current) return;
                scrollRafRef.current = true;
                requestAnimationFrame(() => { updateScrollMetrics(); scrollRafRef.current = false; });
              }}
              style={{
                width: `min(${laneWidth}px, 100vw - 48px)`, // 画面が狭い時は縮む
                background: 'linear-gradient(120deg,#f8fafc 0%,#ffffff 30%,#f1f5f9 100%)',
                border: '1px solid #dbe2ea',
                borderRadius: 20,
                padding: `0 0 0 ${LANE_LEFT_PADDING}px`,
                overflowX: 'auto',
                overscrollBehaviorX: 'contain',
                WebkitOverflowScrolling: 'touch',
                boxShadow: '0 4px 14px -4px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.6)',
                position: 'relative'
              }}
            >
              {(() => {
                // 仮想化: スクロール位置から表示開始インデックス計算
                const wrap = poolScrollRef.current;
                const fullCardWidth = CARD_WIDTH + CARD_GAP;
                let startIndex = 0;
                if (wrap) {
                  // padding-left を除いた領域ベースで計算
                  const effectiveScroll = Math.max(wrap.scrollLeft - LANE_LEFT_PADDING, 0);
                  startIndex = Math.floor(effectiveScroll / fullCardWidth);
                }
                const BUFFER = 2; // 前後バッファ
                const endIndex = Math.min(laneIds.length - 1, startIndex + VISIBLE_COUNT + BUFFER - 1);
                const renderStart = Math.max(0, startIndex - BUFFER);
                const subset: string[] = [];
                for (let i = renderStart; i <= endIndex; i++) subset.push(laneIds[i]);
                const totalWidth = laneIds.length * fullCardWidth - CARD_GAP; // 最後は gap 不要
                return (
                  <div
                    ref={poolRowRef}
                    style={{
                      position: 'relative',
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      touchAction: 'pan-x',
                      width: totalWidth,
                      height: CARD_HEIGHT + 32, // 下の合致率ラベル分余白
                      minHeight: CARD_HEIGHT,
                    }}
                  >
                    {subset.map((id) => {
                      const absoluteIndex = laneIds.indexOf(id);
                      const left = absoluteIndex * fullCardWidth;
                      if (id === '__NEUTRAL_BUCKET__') {
                        return (
                          <div key={id} style={{ position: 'absolute', left, top: 0 }}>
                            <div
                              onClick={() => setShowNeutralBucket(true)}
                              style={{
                                width: CARD_WIDTH,
                                height: CARD_HEIGHT + 32,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                border: '2px dashed #cbd5e1',
                                borderRadius: 16,
                                background: 'linear-gradient(180deg,#f1f5f9 0%,#e2e8f0 100%)',
                                cursor: neutralOnlyIds.length ? 'pointer' : 'default',
                                position: 'relative',
                                boxShadow: '0 6px 16px -6px rgba(15,23,42,0.25)'
                              }}
                            >
                              <div style={{ fontSize: 44, opacity: 0.8 }}>😐</div>
                              <div style={{ fontWeight: 800, fontSize: 14, color: '#475569', letterSpacing: '.5px' }}>どちらでもいい</div>
                              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>クリックで一覧</div>
                              <div style={{ position: 'absolute', top: 6, right: 6, minWidth: 26, padding: '2px 6px', background: '#475569', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 9999, textAlign: 'center' }}>{neutralOnlyIds.length}</div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={id} style={{ position: 'absolute', left, top: 0 }}>
                          {renderCardToken(id, { draggable: true, onClick: () => setSelectedCardId(id) })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {/* フェードエフェクト削除 */}
            </div>
            {/* カスタムスクロールバー */}
            {(() => {
              const { content, viewport } = scrollMetrics;
              const trackW = Math.min(laneWidth, typeof window !== 'undefined' ? window.innerWidth - 48 : laneWidth);
              const maxScroll = Math.max(content - viewport, 0);
              const rawThumb = maxScroll > 0 ? (viewport / content) * trackW : trackW;
              const thumbWidth = Math.max(40, Math.min(rawThumb, trackW));
              const ratio = maxScroll > 0 ? scrollMetrics.scrollLeft / maxScroll : 0;
              const thumbLeft = ratio * (trackW - thumbWidth);
              // ドラッグ開始
              const handleMouseDown = (e: React.MouseEvent) => {
                const wrap = poolScrollRef.current; if (!wrap) return;
                const maxScrollLocal = wrap.scrollWidth - wrap.clientWidth;
                const factor = maxScrollLocal > 0 ? maxScrollLocal / (trackW - thumbWidth) : 1;
                dragRef.current = { dragging: true, startX: e.clientX, startScrollLeft: wrap.scrollLeft, factor };
                document.body.style.userSelect = 'none';
              };
              const handleTrackClick = (e: React.MouseEvent) => {
                if (e.target !== trackRef.current) return; // 背景クリックのみ
                const wrap = poolScrollRef.current; if (!wrap) return;
                const clickX = e.nativeEvent.offsetX;
                const targetLeft = clickX - thumbWidth / 2;
                const clampedLeft = Math.min(Math.max(targetLeft, 0), trackW - thumbWidth);
                const newScroll = (clampedLeft / (trackW - thumbWidth)) * maxScroll;
                wrap.scrollTo({ left: newScroll, behavior: 'smooth' });
              };
              return (
                <div
                  ref={trackRef}
                  onClick={handleTrackClick}
                  style={{
                    position: 'relative',
                    marginTop: 6,
                    height: 14,
                    width: trackW,
                    borderRadius: 9999,
                    background: 'linear-gradient(90deg,#f1f5f9,#f8fafc)',
                    boxShadow: 'inset 0 0 0 1px #e2e8f0',
                    cursor: 'pointer'
                  }}
                >
                  <div
                    onMouseDown={handleMouseDown}
                    style={{
                      position: 'absolute',
                      top: 1,
                      left: thumbLeft,
                      height: 12,
                      width: thumbWidth,
                      borderRadius: 9999,
                      background: 'linear-gradient(90deg,#3b82f6,#6366f1)',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                      cursor: 'grab',
                      transition: 'background .2s'
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background='linear-gradient(90deg,#2563eb,#4f46e5)')}
                    onMouseLeave={e => { if(!dragRef.current.dragging) e.currentTarget.style.background='linear-gradient(90deg,#3b82f6,#6366f1)'; }}
                  />
                </div>
              );
            })()}
          </div>
        </div>

        {/* 下段: 行く / 行かない のドロップエリア */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
          {/* 行く（淡い赤） */}
          <div
            onDragOver={onDragOver}
            onDrop={onDropTo('go')}
            onDragEnter={() => setHoverTarget('go')}
            onDragLeave={() => setHoverTarget(null)}
            style={{
              background: '#fee2e2',
              border: `2px ${hoverTarget==='go' ? 'solid' : 'dashed'} ${hoverTarget==='go' ? '#f87171' : '#fecaca'}`,
              borderRadius: 16,
              padding: 12,
              minHeight: 220,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ color: '#7f1d1d', fontWeight: 900 }}>行く</div>
              <div style={{ color: '#7f1d1d', opacity: 0.7, fontWeight: 700, fontSize: 12 }}>{goIds.length}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {goIds.map((id) => renderCardToken(id))}
            </div>
          </div>

          {/* 行かない（深い青） */}
          <div
            onDragOver={onDragOver}
            onDrop={onDropTo('notgo')}
            onDragEnter={() => setHoverTarget('notgo')}
            onDragLeave={() => setHoverTarget(null)}
            style={{
              background: 'linear-gradient(180deg, #1e3a8a 0%, #1e40af 100%)',
              border: `2px ${hoverTarget==='notgo' ? 'solid' : 'dashed'} ${hoverTarget==='notgo' ? '#60a5fa' : '#334155'}`,
              borderRadius: 16,
              padding: 12,
              minHeight: 220,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ color: '#fff', fontWeight: 900 }}>行かない</div>
              <div style={{ color: '#e2e8f0', opacity: 0.9, fontWeight: 700, fontSize: 12 }}>{notGoIds.length}</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {notGoIds.map((id) => renderCardToken(id))}
            </div>
          </div>
        </div>

        {/* モーダル: カード詳細 + 行く/行かない 決定 */}
        {selectedCardId && (() => {
          const info = getCardInfo(selectedCardId);
            const perUser = userSelections.map(u => {
              // このカードに対するそのユーザーの選択を探索
              let reason = '';
              let category = '' as string;
              for (const [cat, cards] of Object.entries(u.categories)) {
                const hit = cards.find((c: any) => c.id === selectedCardId);
                if (hit) { category = cat; reason = hit.reason || ''; break; }
              }
              return { userName: u.userName || u.userId, planName: u.planName || '—', reason, category };
            });
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
              <div style={{ width: 'min(92vw, 680px)', background: '#fff', borderRadius: 16, boxShadow: '0 24px 80px rgba(2,6,23,0.35)', overflow: 'hidden', userSelect: 'text', WebkitUserSelect: 'text' }}>
                <div style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ flex: '0 0 200px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                    <img src={info?.src} alt="card" style={{ width: '100%', height: 160, objectFit: 'contain', display: 'block', background: '#fff' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>カード詳細</div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        {perUser.map((p, idx) => {
                          const cat = (p.category || 'neutral') as keyof typeof categoryChipStyle;
                          const style = categoryChipStyle[cat];
                          return (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 4, border: '1px solid #e5e7eb', borderRadius: 10, padding: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <div style={{ fontWeight: 800, color: '#0f172a' }}>{p.userName}</div>
                                <div style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, borderRadius: 9999, padding: '2px 8px', fontSize: 12, fontWeight: 900 }}>{categoryName[cat]}</div>
                              </div>
                              <div style={{ color: '#64748b', fontSize: 12 }}>プラン名: <span style={{ fontWeight: 700, color: '#0f172a' }}>{p.planName}</span></div>
                              <div style={{ color: p.reason ? '#334155' : '#94a3b8', fontSize: 13 }}>理由: {p.reason || '（なし）'}</div>
                            </div>
                          );
                        })}
                      </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, padding: 16, justifyContent: 'flex-end' }}>
                  <button onClick={() => setSelectedCardId(null)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', fontWeight: 700, color: '#334155' }}>閉じる</button>
                  <button onClick={async () => { await classifyCard(selectedCardId, 'no'); setSelectedCardId(null); }} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 800 }}>行かない</button>
                  <button onClick={async () => { await classifyCard(selectedCardId, 'go'); setSelectedCardId(null); }} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 800 }}>行く</button>
                </div>
              </div>
            </div>
          );
        })()}
        {/* どちらでもいい バケットモーダル */}
        {showNeutralBucket && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
            <div style={{ width: 'min(92vw, 880px)', maxHeight: '80vh', background: '#fff', borderRadius: 20, boxShadow: '0 30px 80px -20px rgba(15,23,42,0.45)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 900, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 26 }}>😐</span> どちらでもいいカード一覧
                  <span style={{ background: '#475569', color: '#fff', fontSize: 12, padding: '2px 10px', borderRadius: 9999, fontWeight: 800 }}>{neutralOnlyIds.length}</span>
                </div>
                <button onClick={() => setShowNeutralBucket(false)} style={{ fontSize: 13, fontWeight: 700, background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>閉じる</button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 16 }}>
                {neutralOnlyIds.length ? neutralOnlyIds.map(id => {
                  const info = getCardInfo(id);
                  const ag = agreementMap.get(id) ?? 0;
                  return (
                    <div key={id} onClick={() => { setSelectedCardId(id); setShowNeutralBucket(false); }} style={{ cursor: 'pointer', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 8, boxShadow: '0 4px 12px -4px rgba(15,23,42,0.15)', transition: 'transform .15s, box-shadow .15s' }}
                      onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.boxShadow='0 8px 18px -4px rgba(15,23,42,0.25)'; (e.currentTarget as HTMLDivElement).style.transform='translateY(-3px)';}}
                      onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.boxShadow='0 4px 12px -4px rgba(15,23,42,0.15)'; (e.currentTarget as HTMLDivElement).style.transform='translateY(0)';}}
                    >
                      <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 6 }}>
                        <img src={info?.src} alt="card" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info?.title}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textAlign: 'right', marginTop: 2 }}>合致 {ag.toFixed(0)}%</div>
                    </div>
                  );
                }) : <div style={{ fontSize: 14, color: '#64748b', fontWeight: 600 }}>全員どちらでもいいのカードはありません。</div>}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* 終了ボタン (結果ページへ) */}
      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 70 }}>
        <button
          onClick={() => router.push(`/room/${roomId}/result`)}
          style={{
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            color: '#fff',
            fontWeight: 800,
            fontSize: 14,
            padding: '14px 20px',
            border: 'none',
            borderRadius: 14,
            boxShadow: '0 10px 28px -8px rgba(37,99,235,0.55)',
            cursor: 'pointer',
            letterSpacing: '.5px'
          }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow='0 14px 36px -10px rgba(79,70,229,0.65)'; e.currentTarget.style.transform='translateY(-2px)'; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow='0 10px 28px -8px rgba(37,99,235,0.55)'; e.currentTarget.style.transform='translateY(0)'; }}
        >終了して結果を見る</button>
      </div>
    </div>
  );
}
