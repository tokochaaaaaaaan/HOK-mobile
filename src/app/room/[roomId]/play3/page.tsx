"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
import { listenToPresence } from "../../../../../lib/firebase-utils-safe";
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

// カード情報の定義（暫定 10 枚運用）
const TOTAL_CARDS = 10; // 元: 40
const allCards = Array.from({ length: TOTAL_CARDS }, (_, i) => {
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

function Play3PageOld() {
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
  const ratingMatrix = convertSelectionsToMatrix(userSelections, TOTAL_CARDS);
    
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
    // neutral-only のカードは通常レーンから除外し、特殊バケットにまとめる
    const filtered = sortedPoolIds.filter(id => !neutralOnlyIds.includes(id));
    return [...filtered, '__NEUTRAL_BUCKET__'];
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
                                cursor: 'pointer',
                                position: 'relative',
                                boxShadow: '0 6px 16px -6px rgba(15,23,42,0.25)'
                              }}
                            >
                              <div style={{ fontSize: 44, opacity: 0.8 }}>😐</div>
                              <div style={{ fontWeight: 800, fontSize: 14, color: '#475569', letterSpacing: '.5px' }}>どちらでもいい</div>
                              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>クリックで一覧</div>
                              {/* 通知ドット（数値は非表示） */}
                              <div style={{ position: 'absolute', top: 6, right: 10, width: 14, height: 14, background: neutralOnlyIds.length ? '#475569' : '#94a3b8', borderRadius: '50%' }} aria-label={neutralOnlyIds.length ? `中立カード${neutralOnlyIds.length}件` : '中立カードなし'} />
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

// ===================== 新実装（Play3 V2） =====================
export default function Play3Page() {
  const params = useParams();
  const roomId = Array.isArray((params as any).roomId) ? (params as any).roomId[0] : (params as any).roomId;
  const router = useRouter();
  const { userName } = useUser();
  usePreventBack();

  // 画面が狭い場合に全体を少し縮小して表示
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const h = window.innerHeight || 0;
      setScale(h < 900 ? 0.85 : 1);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // カード定義（40枚）
  const ALL_CARDS = useMemo(() => Array.from({ length: 40 }, (_, i) => {
    const idx = i + 1;
    return { id: `card${idx}`, title: `カード${idx}`, src: `/pngs/USJ_${idx}_surface-1.png`, backSrc: `/pngs/back/USJ_${idx}_back-1.png` };
  }), []);

  type CatItem = { id: string; reason?: string };
  type Selections = {
    user: string;
    userId: string;
    userName: string;
    planName?: string;
    categories: {
      veryWant: CatItem[];
      want: CatItem[];
      neutral: CatItem[];
      dont: CatItem[];
      veryDont: CatItem[];
    };
  }[];

  const [selections, setSelections] = useState<Selections>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overallAgreement, setOverallAgreement] = useState(0);
  const [agreementMap, setAgreementMap] = useState<Map<string, number>>(new Map());
  // 入室中ユーザー（RTDB presence）
  const [presentIds, setPresentIds] = useState<string[]>([]);

  // 共有配置（Firestore: rooms/{roomId}/play3Assignments/{cardId} => { status: 'go'|'no'|'vs'|'neutral', pending?: boolean }）
  const [goIds, setGoIds] = useState<string[]>([]);
  const [noIds, setNoIds] = useState<string[]>([]);
  const [vsIds, setVsIds] = useState<string[]>([]);
  const [neutralIds, setNeutralIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [assignLoaded, setAssignLoaded] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 参加者（右上アバター用）
  const [activeUserInfo, setActiveUserInfo] = useState<string | null>(null);
  const [userInfoExpanded, setUserInfoExpanded] = useState<Record<string, boolean>>({});
  // presence を優先して参加者を決定（未取得時は selections をフォールバック）
  const participants = useMemo(() => {
    const ids = (presentIds && presentIds.length) ? presentIds : selections.map(s => s.userId);
    const byId = new Map(selections.map(s => [s.userId, s] as const));
    const list = ids.map((id) => {
      const s = byId.get(id);
      return { id, name: s?.userName || id, plan: s?.planName || '' };
    });
    const seen = new Set<string>();
    return list.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [presentIds, selections]);
  const totalParticipants = participants.length;
  const myUserId = useMemo(() => {
    const me = participants.find(p => p.name === (userName || '') || p.id === (userName || ''));
    return me?.id || (userName || 'unknown');
  }, [participants, userName]);
  const displayParticipants = useMemo(() => {
    const exists = participants.some(p => p.id === myUserId);
    return exists ? participants : [...participants, { id: myUserId, name: userName || '自分', plan: '' }];
  }, [participants, myUserId, userName]);

  // 移行（結果へ）準備状況
  const [play3Ready, setPlay3Ready] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qReady = query(collection(db, 'rooms', roomId, 'play3Ready'));
    const unsub = onSnapshot(qReady, snap => {
      const map: Record<string, boolean> = {};
      snap.docs.forEach(d => {
        const data: any = d.data();
        if (data?.ready) map[data.userId || d.id] = true;
      });
      setPlay3Ready(map);
    });
    return () => unsub();
  }, [roomId]);

  // 全員準備完了で自動遷移
  useEffect(() => {
    // 入室中ユーザーのみで準備完了判定
    const readyCount = (presentIds && presentIds.length)
      ? presentIds.reduce((acc, id) => acc + (play3Ready[id] ? 1 : 0), 0)
      : Object.values(play3Ready).filter(Boolean).length;
    if (totalParticipants > 0 && readyCount === totalParticipants && vsIds.length === 0) {
      router.push(`/room/${roomId}/result`);
    }
  }, [play3Ready, totalParticipants, vsIds.length, router, roomId, presentIds]);

  // finalSelections 購読
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qSel = query(collection(db, 'rooms', roomId, 'finalSelections'));
    const unsub = onSnapshot(qSel, snap => {
      const list: Selections = [] as any;
      snap.docs.forEach(d => {
        const data: any = d.data();
        const norm = normalizeCategories(data.categories || {});
        list.push({
          user: data.user || data.userId || data.userName || d.id,
          userId: data.userId || data.user || data.userName || d.id,
          userName: data.userName || data.user || data.userId || d.id,
          planName: data.planName || data.planname || '',
          categories: {
            veryWant: (norm.verywant || []).map((c: any) => ({ id: c.id, reason: c.reason })),
            want: (norm.want || []).map((c: any) => ({ id: c.id })),
            neutral: (norm.neutral || []).map((c: any) => ({ id: c.id })),
            dont: (norm.dont || []).map((c: any) => ({ id: c.id })),
            veryDont: (norm.verydont || []).map((c: any) => ({ id: c.id, reason: c.reason })),
          }
        });
      });
      setSelections(list);
      setIsLoading(false);
    });
    return () => unsub();
  }, [roomId]);

  // 合致率計算（全体・カード別）
  useEffect(() => {
    if (!selections.length) return;
    const matrix = convertSelectionsToMatrix(selections as any, 40);
    setOverallAgreement(agreementOverall(matrix));
    const map = new Map<string, number>();
    matrix.forEach((ratings, idx) => {
      map.set(`card${idx + 1}`, agreementForCard(ratings));
    });
    setAgreementMap(map);
  }, [selections]);

  // presence 購読（入室中ユーザーだけを分母に）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    let unsub: (() => void) | undefined;
    (async () => {
      unsub = await listenToPresence(roomId as string, (presence) => {
        try {
          const onlineIds = Object.entries(presence || {})
            .filter(([, v]: any) => v && v.online)
            .map(([id]) => id);
          setPresentIds(onlineIds);
        } catch {
          setPresentIds([]);
        }
      });
    })();
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [roomId]);

  // play3Assignments 購読
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qAssign = query(collection(db, 'rooms', roomId, 'play3Assignments'));
    const unsub = onSnapshot(qAssign, snap => {
      if (snap.empty) {
        setAssignLoaded(true);
        return;
      }
      const go: string[] = []; const no: string[] = []; const vs: string[] = []; const neu: string[] = [];
      const pending: Set<string> = new Set();
      snap.docs.forEach(d => {
        const data: any = d.data();
        if (data?.status === 'go') go.push(d.id);
        else if (data?.status === 'no') no.push(d.id);
        else if (data?.status === 'vs') vs.push(d.id);
        else if (data?.status === 'neutral') neu.push(d.id);
        if (data?.pending) pending.add(d.id);
      });
      setGoIds(go); setNoIds(no); setVsIds(vs); setNeutralIds(neu); setPendingIds(pending);
      setAssignLoaded(true);
    });
    return () => unsub();
  }, [roomId]);

  // 初期自動配置（一度だけ・play3Assignments が空のとき）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    if (!assignLoaded || initialized) return;
    if (!selections.length) return;
    // snapshot で空（assignLoaded true かつ go/no/vs/neutral 全て空）なら初期化
    const empty = goIds.length + noIds.length + vsIds.length + neutralIds.length === 0;
    if (!empty) { setInitialized(true); return; }

    const byCard = (id: string) => selections.map(s => ({
      pos: s.categories.veryWant.some(c=>c.id===id) || s.categories.want.some(c=>c.id===id),
      posStrong: s.categories.veryWant.some(c=>c.id===id),
      posReason: (s.categories.veryWant.find(c=>c.id===id)?.reason || '').trim().length>0,
      neg: s.categories.dont.some(c=>c.id===id) || s.categories.veryDont.some(c=>c.id===id),
      negStrong: s.categories.veryDont.some(c=>c.id===id),
      negReason: (s.categories.veryDont.find(c=>c.id===id)?.reason || '').trim().length>0,
      neu: s.categories.neutral.some(c=>c.id===id)
    }));

    const initWrites = async () => {
      for (const card of ALL_CARDS) {
        const arr = byCard(card.id);
        const pos = arr.some(a=>a.pos);
        const neg = arr.some(a=>a.neg);
        const allNeutral = arr.length>0 && arr.every(a=>a.neu);
        const hasNeutral = arr.some(a=>a.neu);
        const hasReason = arr.some(a=>a.posReason || a.negReason);
        let status: 'go'|'no'|'vs'|'neutral' = 'neutral';
        if (pos && !neg && !allNeutral) status = 'go';
        else if (neg && !pos && !allNeutral) status = 'no';
        else if (pos && neg) status = 'vs';
        else if (allNeutral) status = 'neutral';
        else if ((pos && hasNeutral) || (neg && hasNeutral)) status = hasReason ? 'vs' : 'vs';
        else status = 'neutral';
        await setDoc(doc(db, 'rooms', roomId, 'play3Assignments', card.id), {
          status,
          pending: status === 'vs',
          updatedAt: serverTimestamp(),
          updatedBy: userName || 'system',
        }, { merge: true });
      }
      setInitialized(true);
    };
    initWrites();
  }, [assignLoaded, initialized, selections, roomId, userName, goIds.length, noIds.length, vsIds.length, neutralIds.length]);

  // 並び順: 合致率 降順
  const sortByAgreement = useCallback((ids: string[]) => {
    return [...ids].sort((a, b) => (agreementMap.get(b) || 0) - (agreementMap.get(a) || 0));
  }, [agreementMap]);

  // UI: 参加者アイコン（頭文字）
  const renderAvatars = () => (
    <div style={{ display: 'flex', gap: 8 }}>
      {participants.map(p => (
        <button key={p.id} onClick={() => setActiveUserInfo(p.id)} title={p.name} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', fontWeight: 800, color: '#111827' }}>
          {p.name?.[0] || '?'}
        </button>
      ))}
    </div>
  );

  const getCard = (id: string) => ALL_CARDS.find(c => c.id === id);

  // カードモーダル
  const [cardModal, setCardModal] = useState<{ id: string; flipped: boolean } | null>(null);
  const openCard = (id: string) => setCardModal({ id, flipped: false });
  const closeCard = () => setCardModal(null);
  const [uiLocked, setUiLocked] = useState(false);
  const [uiLockReason, setUiLockReason] = useState<null | 'vote' | 'migrate'>(null);

  const classify = async (id: string, status: 'go'|'no'|'vs'|'neutral', pending?: boolean) => {
    if (!roomId || typeof roomId !== 'string') return;
    if (uiLocked) return; // ロック中は操作不可
    await setDoc(doc(db, 'rooms', roomId, 'play3Assignments', id), { status, pending: !!pending, updatedAt: serverTimestamp(), updatedBy: userName || 'unknown' }, { merge: true });
    closeCard();
  };

  // ===== 全員投票モード =====
  type ActiveVote = { cardId: string; sessionId: string; modalOpen: boolean; initiatedBy?: string } | null;
  const [activeVote, setActiveVote] = useState<ActiveVote>(null);
  const [voteMap, setVoteMap] = useState<Record<string, 'go'|'no'>>({});
  const [myVoteChoice, setMyVoteChoice] = useState<'go'|'no'|null>(null);

  // 状態購読（全員へモーダル同期）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const unsub = onSnapshot(doc(db, 'rooms', roomId, 'play3State', 'state'), (snap) => {
      const data: any = snap.data();
      if (data) {
        const next: ActiveVote = { cardId: data.cardId || '', sessionId: data.sessionId || '', modalOpen: !!data.modalOpen, initiatedBy: data.initiatedBy };
        setActiveVote(next);
        if (next.modalOpen && next.cardId) {
          setCardModal((m) => (m?.id === next.cardId ? m : { id: next.cardId, flipped: false }));
        }
      } else {
        setActiveVote(null);
      }
    });
    return () => unsub();
  }, [roomId]);

  // 投票状況購読（モーダル表示中のみ）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const cid = activeVote?.cardId;
    if (!cid || !activeVote?.modalOpen) { setVoteMap({}); return; }
    const nameToId = new Map<string,string>(participants.map(p => [p.name, p.id]));
    const validIds = new Set(participants.map(p => p.id));
    const unsub = onSnapshot(doc(db, 'rooms', roomId, 'play3Votes', cid), (snap) => {
      const data: any = snap.data();
      const raw = data?.sessionId === activeVote.sessionId ? (data?.votes || {}) : {};
      // 正規化: userName キーが来ても userId に寄せる
      const normalized: Record<string,'go'|'no'> = {};
      Object.entries(raw).forEach(([k,v]) => {
        const vv = v as 'go'|'no';
        if (validIds.has(k)) {
          normalized[k] = vv;
        } else if (nameToId.has(k)) {
          normalized[nameToId.get(k)!] = vv;
        } else {
          // 不明キーはそのまま保持（互換）
          normalized[k] = vv;
        }
      });
      setVoteMap(normalized);
    });
    return () => unsub();
  }, [roomId, activeVote?.cardId, activeVote?.sessionId, activeVote?.modalOpen]);

  // 全員投票完了で自動判定・クローズ（userId キーで集計）
  useEffect(() => {
    if (!activeVote?.modalOpen) return;
    const total = participants.length;
    if (total <= 0 || !activeVote.cardId) return;
    const byId: Record<string, 'go'|'no'> = {};
    for (const p of participants) {
      const v = voteMap[p.id] as 'go'|'no'|undefined;
      if (v) byId[p.id] = v;
    }
    // 自分のローカル選択がまだ反映されていない場合の補完
    if (myUserId && myVoteChoice && !byId[myUserId]) byId[myUserId] = myVoteChoice;
    const voted = Object.keys(byId).length;
    if (voted >= total) {
      const votes = Object.values(byId);
      const allGo = votes.every(v => v === 'go');
      const allNo = votes.every(v => v === 'no');
      (async () => {
        if (allGo) await setDoc(doc(db, 'rooms', roomId!, 'play3Assignments', activeVote.cardId), { status: 'go', pending: false, updatedAt: serverTimestamp(), updatedBy: userName || 'unknown' }, { merge: true });
        else if (allNo) await setDoc(doc(db, 'rooms', roomId!, 'play3Assignments', activeVote.cardId), { status: 'no', pending: false, updatedAt: serverTimestamp(), updatedBy: userName || 'unknown' }, { merge: true });
        else await setDoc(doc(db, 'rooms', roomId!, 'play3Assignments', activeVote.cardId), { status: 'vs', pending: true, updatedAt: serverTimestamp(), updatedBy: userName || 'unknown' }, { merge: true });
        await setDoc(doc(db, 'rooms', roomId!, 'play3State', 'state'), { modalOpen: false, closedAt: serverTimestamp() }, { merge: true });
        setUiLocked(false);
        setUiLockReason(null);
        setMyVoteChoice(null);
        closeCard();
      })();
    }
  }, [activeVote?.modalOpen, voteMap, participants, myVoteChoice, roomId, myUserId]);

  const startVote = async (choice: 'go'|'no', targetCardId?: string) => {
    if (!roomId || typeof roomId !== 'string') return;
    const cid = targetCardId || cardModal?.id;
    if (!cid) return;
    const sessionId = `${cid}-${Date.now()}`;
    await setDoc(doc(db, 'rooms', roomId, 'play3State', 'state'), {
      cardId: cid,
      modalOpen: true,
      sessionId,
      initiatedBy: userName || 'unknown',
      updatedAt: serverTimestamp(),
    }, { merge: true });
    const myKey = myUserId;
    await setDoc(doc(db, 'rooms', roomId, 'play3Votes', cid), {
      sessionId,
      updatedAt: serverTimestamp(),
      [`votes.${myKey}`]: choice,
    } as any, { merge: true });
    setUiLocked(true); // 最初に押した人はロック
    setUiLockReason('vote');
    setMyVoteChoice(choice);
    // 押した瞬間に自分の投票アイコンを出す（楽観更新）
    try {
      setVoteMap(prev => ({
        ...prev,
        [myUserId]: choice,
      }));
    } catch {}
  };

  const castVote = async (choice: 'go'|'no') => {
    if (!roomId || typeof roomId !== 'string' || !activeVote?.cardId || !activeVote?.sessionId) return;
    // 押した瞬間に自分の投票アイコンを出す（楽観更新）
    try {
      setMyVoteChoice(choice);
      setVoteMap(prev => ({
        ...prev,
        [myUserId]: choice,
      }));
    } catch {}
    const myKey = myUserId;
    await setDoc(doc(db, 'rooms', roomId, 'play3Votes', activeVote.cardId), {
      sessionId: activeVote.sessionId,
      updatedAt: serverTimestamp(),
      [`votes.${myKey}`]: choice,
    } as any, { merge: true });
  };

  // Neutral 折りたたみ
  const [neutralOpen, setNeutralOpen] = useState(false);

  if (isLoading) {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>読み込み中...</div>;
  }

  // 整列済み ID
  const goSorted = sortByAgreement(goIds);
  const noSorted = sortByAgreement(noIds);
  const vsSorted = sortByAgreement(vsIds);
  const neuSorted = sortByAgreement(neutralIds);

  // 縮小時はカード幅も少し小さく
  const TILE_W = scale < 1 ? 180 : 220;

  return (
    <div style={{ minHeight: '100vh', background: '#fff', overflowX: 'hidden', cursor: uiLocked && uiLockReason==='vote' ? 'progress' : 'default' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
      {/* ヘッダー行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ fontWeight: 900, color: '#111827' }}>合致率 {overallAgreement.toFixed(0)}%</div>
        {renderAvatars()}
      </div>

      {/* 開始メッセージ */}
      <div style={{ padding: '10px 16px', background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e', fontWeight: 700 }}>
        全員の要望に沿ってカードを各エリアに当てはめました！VSのカードがなくなったらゲーム終了です！
      </div>

  {/* 上段: 行く / 行かない（画面幅に応じて折り返し） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12, padding: 12 }}>
        {/* 行く */}
        <section style={{ minWidth: 0, background: '#fee2e2', border: '2px solid #fca5a5', borderRadius: 12, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 900, color: '#7f1d1d' }}>行く</div>
            <div style={{ color: '#7f1d1d', fontWeight: 700 }}>{goSorted.length}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, flexWrap: 'nowrap' }}>
            {goSorted.map(id => {
              const info = getCard(id);
              const ag = agreementMap.get(id) || 0;
              return (
                <div key={id} onClick={() => openCard(id)} style={{ cursor: 'pointer', width: TILE_W, flex: '0 0 auto', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                    <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                  <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, color: '#111827', fontSize: 12 }}>{info?.title}</div>
                    <div style={{ fontWeight: 800, color: '#334155', fontSize: 12 }}>{ag.toFixed(0)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 行かない */}
        <section style={{ minWidth: 0, background: '#1e3a8a', border: '2px solid #334155', borderRadius: 12, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 900, color: '#fff' }}>行かない</div>
            <div style={{ color: '#e2e8f0', fontWeight: 700 }}>{noSorted.length}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, flexWrap: 'nowrap' }}>
            {noSorted.map(id => {
              const info = getCard(id);
              const ag = agreementMap.get(id) || 0;
              return (
                <div key={id} onClick={() => openCard(id)} style={{ cursor: 'pointer', width: TILE_W, flex: '0 0 auto', border: '1px solid #475569', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                    <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                  <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, color: '#111827', fontSize: 12 }}>{info?.title}</div>
                    <div style={{ fontWeight: 800, color: '#334155', fontSize: 12 }}>{ag.toFixed(0)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* 中央: 議論中（VS） */}
          <div style={{ padding: '0 12px 12px' }}>
        <section style={{ background: '#ffedd5', border: '2px solid #fdba74', borderRadius: 12, padding: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 900, color: '#9a3412' }}>議論中（VS）</div>
            <div style={{ color: '#9a3412', fontWeight: 700 }}>{vsSorted.length}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, flexWrap: 'nowrap' }}>
            {vsSorted.map(id => {
              const info = getCard(id);
              const ag = agreementMap.get(id) || 0;
              const pending = pendingIds.has(id);
              return (
                    <div key={id} onClick={() => openCard(id)} style={{ cursor: 'pointer', width: TILE_W, flex: '0 0 auto', border: pending ? '6px solid #000' : '2px solid #e5e7eb', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                    <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                  <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, color: '#111827', fontSize: 12 }}>{info?.title}</div>
                    <div style={{ fontWeight: 800, color: '#334155', fontSize: 12 }}>{ag.toFixed(0)}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* 下部: どちらでも（折りたたみ・モーダル表示） */}
      <div style={{ padding: '0 12px 80px' }}>
        <section style={{ background: '#e5e7eb', border: '2px solid #d1d5db', borderRadius: 12, overflow: 'hidden' }}>
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, cursor: 'pointer' }}
            onClick={() => setNeutralOpen(true)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 900, color: '#374151' }}>どちらでも</div>
              <div style={{ transform: neutralOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>^</div>
            </div>
            <div style={{ color: '#374151', fontWeight: 700 }}>{neuSorted.length}</div>
          </div>
        </section>
      </div>

      {/* どちらでも一覧モーダル（Play1 の "すべて見る" 風） */}
      {neutralOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}
          onClick={() => setNeutralOpen(false)}
        >
          <div
            style={{ width: 'min(92vw, 960px)', maxHeight: '80vh', background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 24px 80px rgba(0,0,0,0.35)', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 18, color: '#111827' }}>どちらでも（{neuSorted.length}）</div>
              <button onClick={() => setNeutralOpen(false)} style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '6px 10px', fontWeight: 800 }}>閉じる</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
              {neuSorted.map(id => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                return (
                  <div
                    key={id}
                    onClick={() => { setNeutralOpen(false); openCard(id); }}
                    style={{ cursor: 'pointer', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, overflow: 'hidden' }}
                  >
                    <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                      <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div style={{ padding: '6px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontWeight: 800, color: '#111827', fontSize: 12 }}>{info?.title}</div>
                      <div style={{ fontWeight: 800, color: '#334155', fontSize: 12 }}>{ag.toFixed(0)}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 参加者情報モーダル */}
      {activeUserInfo && (() => {
        const user = selections.find(s => s.userId === activeUserInfo);
        const counts = user ? {
          veryWant: user.categories.veryWant.length,
          want: user.categories.want.length,
          neutral: user.categories.neutral.length,
          dont: user.categories.dont.length,
          veryDont: user.categories.veryDont.length,
        } : { veryWant: 0, want: 0, neutral: 0, dont: 0, veryDont: 0 };
        const catOrder: Array<{key: keyof typeof counts; label: string}> = [
          { key: 'veryWant', label: '特に行きたい' },
          { key: 'want', label: '行きたい' },
          { key: 'neutral', label: 'どちらでも' },
          { key: 'dont', label: '行きたくない' },
          { key: 'veryDont', label: '特に行きたくない' },
        ];
        const getList = (k: keyof typeof counts) => (user ? user.categories[k] : []);
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setActiveUserInfo(null)}>
            <div style={{ width: 420, background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e=>e.stopPropagation()}>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>{user?.userName}</div>
              <div style={{ color: '#374151', marginBottom: 10 }}>プラン名：<strong style={{ color: '#2563eb' }}>{user?.planName || '—'}</strong></div>
              <div style={{ display: 'grid', gap: 8 }}>
                {catOrder.map(({key,label}) => {
                  const expanded = !!userInfoExpanded[key as string];
                  const toggle = () => setUserInfoExpanded(prev => ({ ...prev, [key as string]: !expanded }));
                  const list = getList(key);
                  return (
                    <div key={key} style={{ border: '1px solid #e5e7eb', borderRadius: 10 }}>
                      <div onClick={toggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', cursor: 'pointer' }}>
                        <div>{label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontWeight: 800 }}>{list.length}</span>
                          <span style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>^</span>
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ padding: '8px 10px', display: 'grid', gap: 6 }}>
                          {list.length ? list.map((c, idx) => {
                            const info = ALL_CARDS.find(x=>x.id === c.id);
                            const reason = (c as any).reason || '';
                            return (
                              <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
                                <div style={{ fontWeight: 700, color: '#0f172a' }}>{info?.title || c.id}</div>
                                <div style={{ fontSize: 12, color: reason ? '#374151' : '#94a3b8' }}>理由: {reason || '（なし）'}</div>
                              </div>
                            );
                          }) : <div style={{ fontSize: 12, color: '#94a3b8' }}>カードはありません</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ textAlign: 'right', marginTop: 12 }}>
                <button onClick={() => setActiveUserInfo(null)} style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontWeight: 700 }}>閉じる</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* カード詳細モーダル */}
      {cardModal && (() => {
        const info = getCard(cardModal.id);
        const users = selections.map(u => {
          let category: string = 'neutral';
          let reason = '';
          if (u.categories.veryWant.some(c=>c.id===cardModal.id)) { category='veryWant'; reason = u.categories.veryWant.find(c=>c.id===cardModal.id)?.reason || ''; }
          else if (u.categories.want.some(c=>c.id===cardModal.id)) category='want';
          else if (u.categories.dont.some(c=>c.id===cardModal.id)) category='dont';
          else if (u.categories.veryDont.some(c=>c.id===cardModal.id)) { category='veryDont'; reason = u.categories.veryDont.find(c=>c.id===cardModal.id)?.reason || ''; }
          else if (u.categories.neutral.some(c=>c.id===cardModal.id)) category='neutral';
          return { userName: u.userName, planName: u.planName || '—', category, reason };
        });
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120 }}
            onClick={() => {
              // 全員投票モードの最中は外クリックで閉じられない（全員統一表示を維持）
              if (activeVote?.modalOpen) return;
              closeCard();
            }}
          >
            <div style={{ width: 'min(92vw, 760px)', background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.35)' }} onClick={(e)=>e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ flex: '0 0 240px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div onClick={()=>setCardModal(m=>m && ({...m, flipped: !m.flipped}))} style={{ width: 220, height: 320, cursor: 'pointer', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                    <img src={cardModal.flipped ? (info?.backSrc || info?.src) : (info?.src)} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                  <div style={{ marginTop: 8, fontWeight: 800, color: '#111827' }}>{info?.title}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>各ユーザーの選択（1人フェーズ時点）</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {users.map((u, idx) => (
                      <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ fontWeight: 800 }}>{u.userName}</div>
                          <div style={{ fontSize: 12, fontWeight: 800, color: '#2563eb' }}>プラン名：{u.planName}</div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <div>カテゴリ：<strong>{({
                            veryWant: '特に行きたい',
                            want: '行きたい',
                            neutral: 'どちらでも',
                            dont: '行きたくない',
                            veryDont: '特に行きたくない'
                          } as Record<string,string>)[u.category] || '—'}</strong></div>
                          <div style={{ color: u.reason ? '#374151' : '#94a3b8' }}>理由: {u.reason || '（なし）'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {/* 自分の過去投票に戻す（自分が過去に「行きたい/行きたくない」に入れていた場合のみ表示。投票中は無効） */}
                {(() => {
                  const me = selections.find(s => s.userName === userName || s.userId === userName);
                  let prev: 'go' | 'no' | 'neutral' | null = null;
                  if (me) {
                    if (me.categories.veryWant.some(c=>c.id===cardModal.id) || me.categories.want.some(c=>c.id===cardModal.id)) prev = 'go';
                    else if (me.categories.veryDont.some(c=>c.id===cardModal.id) || me.categories.dont.some(c=>c.id===cardModal.id)) prev = 'no';
                    else if (me.categories.neutral.some(c=>c.id===cardModal.id)) prev = 'neutral';
                  }
                  // neutral または過去無しのときは表示自体をしない（混乱回避）
                  if (!prev || prev === 'neutral') return null;
                  const label = prev === 'go' ? '行く' : '行かない';
                  const disabled = uiLocked || !!activeVote?.modalOpen;
                  return (
                    <button disabled={disabled} onClick={() => classify(cardModal.id, prev)}
                      style={{ opacity: disabled ? .5 : 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#f8fafc', fontWeight: 800, color: '#0f172a' }}>
                      {`自分の過去投票に戻す（${label}）`}
                    </button>
                  );
                })()}
                <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
                  <button
                    onClick={() => { if (!activeVote?.modalOpen) classify(cardModal.id, 'vs', true); }}
                    disabled={uiLocked || !!activeVote?.modalOpen}
                    style={{
                      opacity: (uiLocked || activeVote?.modalOpen) ? .6 : 1,
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: '2px solid #fdba74',
                      background: '#ffedd5',
                      color: '#9a3412',
                      fontWeight: 900
                    }}
                  >保留して閉じる</button>
                  {(() => {
                    const myChoice = myVoteChoice || voteMap[myUserId];
                    const hasVoted = !!myChoice;
                    const votedNo = myChoice === 'no';
                    const votedGo = myChoice === 'go';
                    const goCount = participants.reduce((acc, p) => {
                      const v = voteMap[p.id];
                      const mine = p.id === myUserId ? (myVoteChoice || v) : v;
                      return acc + (mine === 'go' ? 1 : 0);
                    }, 0);
                    const noCount = participants.reduce((acc, p) => {
                      const v = voteMap[p.id];
                      const mine = p.id === myUserId ? (myVoteChoice || v) : v;
                      return acc + (mine === 'no' ? 1 : 0);
                    }, 0);
                    const noStyle: any = {
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: votedNo ? '#172554' : '#1e3a8a',
                      color: '#fff',
                      fontWeight: 900,
                      boxShadow: votedNo ? '0 0 0 3px rgba(30,58,138,0.35) inset' : undefined,
                      transform: votedNo ? 'translateY(1px)' : undefined,
                      transition: 'all .12s ease',
                      opacity: hasVoted && !votedNo ? .6 : 1,
                      cursor: hasVoted && !votedNo ? 'not-allowed' : 'pointer'
                    };
                    const goStyle: any = {
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: votedGo ? '#b91c1c' : '#ef4444',
                      color: '#fff',
                      fontWeight: 900,
                      boxShadow: votedGo ? '0 0 0 3px rgba(239,68,68,0.35) inset' : undefined,
                      transform: votedGo ? 'translateY(1px)' : undefined,
                      transition: 'all .12s ease',
                      opacity: hasVoted && !votedGo ? .6 : 1,
                      cursor: hasVoted && !votedGo ? 'not-allowed' : 'pointer'
                    };
                    // 投票進捗（押したかどうかの全体統計）
                    const votedCount = displayParticipants.reduce((acc, p) => {
                      const v = voteMap[p.id];
                      const mine = p.id === myUserId ? (myVoteChoice || v) : v;
                      return acc + (mine ? 1 : 0);
                    }, 0);
                    return (
                      <>
                        <div style={{ position: 'absolute', top: -24, right: 0, fontSize: 11, fontWeight: 800, color: '#374151', background: 'rgba(255,255,255,0.8)', padding: '2px 6px', borderRadius: 8 }}>
                          投票済み {votedCount}/{totalParticipants}
                        </div>
                        <div style={{ position: 'relative' }}>
                          <button aria-pressed={votedNo} disabled={hasVoted && !votedNo} onClick={() => (!hasVoted ? (activeVote?.modalOpen && activeVote.cardId===cardModal.id ? castVote('no') : startVote('no', cardModal.id)) : undefined)} style={noStyle}>
                            行かない {noCount}/{totalParticipants}
                          </button>
                          <div style={{ position: 'absolute', top: -10, right: -8, display: 'flex', zIndex: 5, pointerEvents: 'none' }}>
                            {displayParticipants.filter(p => voteMap[p.id] === 'no' || (p.id===myUserId && myVoteChoice==='no')).map(p => (
                              <span key={p.id} title={p.name} style={{ width: 18, height: 18, borderRadius: '50%', background: '#e2e8f0', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: -6 }}>{p.name?.[0] || '?'}</span>
                            ))}
                          </div>
                        </div>
                        <div style={{ position: 'relative' }}>
                          <button aria-pressed={votedGo} disabled={hasVoted && !votedGo} onClick={() => (!hasVoted ? (activeVote?.modalOpen && activeVote.cardId===cardModal.id ? castVote('go') : startVote('go', cardModal.id)) : undefined)} style={goStyle}>
                            行く {goCount}/{totalParticipants}
                          </button>
                          <div style={{ position: 'absolute', top: -10, right: -8, display: 'flex', zIndex: 5, pointerEvents: 'none' }}>
                            {displayParticipants.filter(p => voteMap[p.id] === 'go' || (p.id===myUserId && myVoteChoice==='go')).map(p => (
                              <span key={p.id} title={p.name} style={{ width: 18, height: 18, borderRadius: '50%', background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: -6 }}>{p.name?.[0] || '?'}</span>
                            ))}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* フッター: 終了ボタン（VS がゼロのとき活性） */}
      </div>
      {/* フッター: 移行（全員の投票完了を待機） */}
      <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 80 }}>
        <button
          disabled={vsSorted.length > 0 || uiLocked}
          onClick={async () => {
            if (!roomId || typeof roomId !== 'string' || !userName) return;
            await setDoc(doc(db, 'rooms', roomId, 'play3Ready', userName), { userId: userName, ready: true, updatedAt: serverTimestamp() }, { merge: true });
            setUiLocked(true);
            setUiLockReason('migrate');
          }}
          style={{
            opacity: vsSorted.length>0 || uiLocked ? .5 : 1,
            background: 'linear-gradient(135deg,#2563eb,#4f46e5)',
            color: '#fff',
            fontWeight: 900,
            padding: '12px 18px',
            border: 'none',
            borderRadius: 12,
            boxShadow: '0 10px 28px -8px rgba(37,99,235,0.55)',
            cursor: vsSorted.length>0 || uiLocked ? 'not-allowed' : 'pointer'
          }}
        >終了して結果を見る</button>
      </div>

      {/* ロック中オーバーレイ */}
      {uiLocked && uiLockReason==='migrate' && (() => {
        const readyCount = Object.values(play3Ready).filter(Boolean).length;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(2px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto' }}>
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.15)', fontWeight: 800, color: '#0f172a' }}>
              投票を送信しました。他の参加者の投票完了を待っています…（{readyCount}/{totalParticipants}）
            </div>
          </div>
        );
      })()}
    </div>
  );
}
