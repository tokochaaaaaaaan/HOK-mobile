"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { agreementOverall, convertSelectionsToMatrix } from '../../../../utils/agreement-calculator';
import { db } from '../../../../../lib/firebase';
import { normalizeCategories } from '../../../../utils/normalizeCategories';
import MapButton from '@/components/MapButton';
import { useUser } from '@/context/UserContext';
import { activeCards as baseCards } from '@/data/cards';

// カード定義（全39枚・共通データから生成）
const allCards = baseCards.map((c) => ({
  id: `card${c.id}`,
  title: c.title,
  src: c.frontSrc,
}));

type FinalSelectionDoc = {
  userId: string;
  userName?: string;
  planName?: string;
  categories: any;
};

 type CatItem = { id: string };
 type UserSelection = {
   userId: string;
   userName: string;
   planName: string;
   categories: {
     want: CatItem[];
     neutral: CatItem[];
     dont: CatItem[];
   };
 };

type MatchAnalysisData = {
  userId: string;
  userName: string;
  plusSum: number;
  minusSum: number;
  computedAt?: any;
};

type MatchAnalysisPairData = {
  userAId: string;
  userAName: string;
  userBId: string;
  userBName: string;
  plusCount: number;
  minusCount: number;
  computedAt?: any;
};

export default function ResultPage() {
  const { roomId } = useParams();
  const { userName: currentUserName } = useUser();
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);
  const [selections, setSelections] = useState<UserSelection[]>([]);
  const [goIds, setGoIds] = useState<string[]>([]);
  const [noIds, setNoIds] = useState<string[]>([]);
  const [neutralIds, setNeutralIds] = useState<string[]>([]);
  const [vsIds, setVsIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cardModal, setCardModal] = useState<string | null>(null);
  const [overallAgreement, setOverallAgreement] = useState<number>(0);
  const [activeUserInfo, setActiveUserInfo] = useState<string | null>(null);
  const [userInfoExpanded, setUserInfoExpanded] = useState<Record<string, boolean>>({});
  const [allCardsModalOpen, setAllCardsModalOpen] = useState(false);
  const [categoryDetailModal, setCategoryDetailModal] = useState<{ userId: string; category: string } | null>(null);
  const [expandedCard, setExpandedCard] = useState<{ id: string; flipped: boolean } | null>(null);
  const [matchAnalysis, setMatchAnalysis] = useState<MatchAnalysisData[]>([]);
  const [matchAnalysisPairs, setMatchAnalysisPairs] = useState<MatchAnalysisPairData[]>([]);

  // スマホ幅判定
  useEffect(() => {
    const update = () => setIsNarrowScreen(window.innerWidth <= 420);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // モーダル開閉時にbodyのスクロールを制御
  useEffect(() => {
    const isModalOpen = activeUserInfo || allCardsModalOpen || categoryDetailModal || cardModal || expandedCard;
    if (isModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [activeUserInfo, allCardsModalOpen, categoryDetailModal, cardModal, expandedCard]);

  // 初期: go/no/neutralだけ展開
  useEffect(() => {
    setExpanded({ go: true, no: true, neutral: true, vs: true });
  }, []);

  // finalSelections 購読
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qSel = query(collection(db, 'rooms', roomId, 'finalSelections'));
    const unsub = onSnapshot(qSel, snap => {
      const list: UserSelection[] = [];
      snap.docs.forEach(d => {
        const data = d.data() as FinalSelectionDoc;
        const norm = normalizeCategories(data.categories || {});
        console.log('Final selection data:', data); // デバッグログ
        const mergedWant = [...(norm.want || []), ...(norm.veryWant || [])];
        const mergedDont = [...(norm.dont || []), ...(norm.veryDont || [])];
         list.push({
           userId: data.userId || d.id,
           userName: data.userName || data.userId || d.id,
           planName: data.planName || 'プラン名未設定',
           categories: {
             want: mergedWant.map((c: any) => ({ id: c.id })),
             neutral: (norm.neutral || []).map((c: any) => ({ id: c.id })),
             dont: mergedDont.map((c: any) => ({ id: c.id })),
           }
         });
      });
      console.log('Processed selections:', list); // デバッグログ
      setSelections(list);
    });
    return () => unsub();
  }, [roomId]);

  // matchAnalysis 購読（合致度データ）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qMatch = query(collection(db, 'rooms', roomId, 'matchAnalysis'));
    const unsub = onSnapshot(qMatch, snap => {
      const analysis: MatchAnalysisData[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        analysis.push({
          userId: data.userId,
          userName: data.userName,
          plusSum: data.plusSum || 0,
          minusSum: data.minusSum || 0,
          computedAt: data.computedAt
        });
      });
      setMatchAnalysis(analysis);
    });
    return () => unsub();
  }, [roomId]);

  // matchAnalysisPairs 購読（ペアごとの詳細合致度）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qPairs = query(collection(db, 'rooms', roomId, 'matchAnalysisPairs'));
    const unsub = onSnapshot(qPairs, snap => {
      const pairs: MatchAnalysisPairData[] = [];
      snap.docs.forEach(d => {
        const data = d.data();
        pairs.push({
          userAId: data.userAId,
          userAName: data.userAName,
          userBId: data.userBId,
          userBName: data.userBName,
          plusCount: data.plusCount || 0,
          minusCount: data.minusCount || 0,
          computedAt: data.computedAt
        });
      });
      setMatchAnalysisPairs(pairs);
    });
    return () => unsub();
  }, [roomId]);
  // play3Assignments 購読（go/no/neutralの最終決定）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qAssign = query(collection(db, 'rooms', roomId, 'play3Assignments'));
    const unsub = onSnapshot(qAssign, snap => {
      const go: string[] = [];
      const no: string[] = [];
      const neutral: string[] = [];
      const vs: string[] = [];
      snap.docs.forEach(d => {
        const data: any = d.data();
        if (data?.status === 'go') go.push(d.id);
        else if (data?.status === 'no') no.push(d.id);
        else if (data?.status === 'neutral') neutral.push(d.id);
        else if (data?.status === 'vs') vs.push(d.id);
      });
      setGoIds(go);
      setNoIds(no);
      setNeutralIds(neutral);
      setVsIds(vs);
    });
    return () => unsub();
  }, [roomId]);

  // カード→ユーザー選択逆引きマップ
  const cardChoiceMap = useMemo(() => {
    type Entry = { userId: string; userName: string; planName: string; category: string };
    const map: Record<string, { users: Entry[] }> = {};
    selections.forEach(sel => {
      (Object.entries(sel.categories) as [string, CatItem[]][]).forEach(([cat, arr]) => {
        arr.forEach(item => {
          if (!map[item.id]) map[item.id] = { users: [] };
          map[item.id].users.push({ userId: sel.userId, userName: sel.userName, planName: sel.planName, category: cat });
        });
      });
    });
    return map;
  }, [selections]);

  // 各セクション表示用カード（go/no/neutralに基づく最終決定を最優先表示）
  const sectionCards = useMemo(() => {
    return { go: goIds, no: noIds, neutral: neutralIds, vs: vsIds };
  }, [goIds, noIds, neutralIds, vsIds]);
  const uniqueSectionCards = useMemo(() => {
    const r: Record<string, string[]> = {};
    Object.entries(sectionCards).forEach(([k, arr]) => {
      const seen = new Set<string>();
      r[k] = [];
      // カード番号順にソート（card1, card2, card3...）
      const sortedArr = [...arr].sort((a, b) => {
        const numA = parseInt(a.replace('card', ''), 10);
        const numB = parseInt(b.replace('card', ''), 10);
        return numA - numB;
      });
      sortedArr.forEach(id => { if (!seen.has(id)) { seen.add(id); r[k].push(id); } });
    });
    return r;
  }, [sectionCards]);

  const participantsSummary = useMemo(() => selections.map(s => s.userName).join('・'), [selections]);

  // 参加者のカテゴリ別カード数を計算
  const participantStats = useMemo(() => {
    return selections.map(sel => ({
      userId: sel.userId,
      userName: sel.userName,
      planName: sel.planName,
      counts: {
        want: sel.categories.want.length,
        neutral: sel.categories.neutral.length,
        dont: sel.categories.dont.length,
      }
    }));
  }, [selections]);

  // 全カード一覧のため、全カードに対する最終カテゴリを決定
  const allCardsWithFinalCategory = useMemo(() => {
    const ALL_CARDS = baseCards.map((c) => `card${c.id}`);
    return ALL_CARDS.map(cardId => {
      let finalCategory = 'unassigned';
      if (goIds.includes(cardId)) finalCategory = 'go';
      else if (noIds.includes(cardId)) finalCategory = 'no';
      else if (neutralIds.includes(cardId)) finalCategory = 'neutral';
      else if (vsIds.includes(cardId)) finalCategory = 'vs';
      
      const users = cardChoiceMap[cardId]?.users || [];
      return { cardId, finalCategory, users };
    }).sort((a, b) => {
      // カード番号順にソート（card1, card2, card3...）
      const numA = parseInt(a.cardId.replace('card', ''), 10);
      const numB = parseInt(b.cardId.replace('card', ''), 10);
      return numA - numB;
    });
  }, [goIds, noIds, neutralIds, vsIds, cardChoiceMap]);

  const closeUserInfoModal = () => {
    setActiveUserInfo(null);
    setUserInfoExpanded({}); // 全ての展開状態をリセット
    setCategoryDetailModal(null); // カテゴリ詳細モーダルも閉じる
  };

  const getCardInfo = (id: string) => allCards.find(c => c.id === id);

  // 合致率計算
  useEffect(() => {
    if (!selections.length) return;
    // convertSelectionsToMatrix を使うため play3 同等形式に合わせる
    const pseudo = selections.map(s => ({
      userId: s.userId,
      userName: s.userName,
      categories: {
        want: s.categories.want,
        neutral: s.categories.neutral,
        dont: s.categories.dont,
        veryWant: [],
        veryDont: [],
      }
    }));
    const matrix = convertSelectionsToMatrix(pseudo as any, 39);
    const overall = agreementOverall(matrix);
    setOverallAgreement(overall);
  }, [selections]);

  const categoryChipStyle: Record<string, { bg: string; text: string; border: string }> = {
    // veryWant: { bg: '#fecaca', text: '#7f1d1d', border: '#fca5a5' },
    want: { bg: '#fce7f3', text: '#9d174d', border: '#fbcfe8' },
    neutral: { bg: '#e5e7eb', text: '#374151', border: '#d1d5db' },
    dont: { bg: '#bae6fd', text: '#0c4a6e', border: '#93c5fd' },
    go: { bg: '#fecaca', text: '#991b1b', border: '#fca5a5' },      // 柔らかい赤
    no: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },      // 柔らかい青
    vs: { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },      // 柔らかい橙
    unassigned: { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
  };

  const categoryNames: Record<string, string> = {
    // veryWant: '特に行きたい',
    want: '行きたい',
    neutral: 'どちらでもいい',
    dont: '行きたくない',
    go: '行く',
    no: '行かない',
    vs: '議論中（VS）',
    unassigned: '未分類',
  };

  // アバター表示
  const renderAvatars = () => (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: isNarrowScreen ? 'nowrap' : 'wrap',
        overflowX: isNarrowScreen ? 'auto' : 'visible',
        paddingBottom: isNarrowScreen ? 4 : 0,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {participantStats.map(p => {
        const isSelf = p.userName === currentUserName;
        return (
          <button
            key={p.userId}
            onClick={() => setActiveUserInfo(p.userId)}
            title={p.userName}
            style={{
              width: isNarrowScreen ? 30 : 32,
              height: isNarrowScreen ? 30 : 32,
              borderRadius: '50%',
              border: isSelf ? '2px solid #ef4444' : '1px solid #e5e7eb',
              background: '#fff',
              boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
              fontWeight: 800,
              color: '#111827',
              flex: '0 0 auto',
            }}
          >
            {p.userName?.[0] || '?'}
          </button>
        );
      })}
    </div>
  );

  const renderCard = (cardId: string) => {
    const info = getCardInfo(cardId);
    const users = cardChoiceMap[cardId]?.users || [];
    return (
      <div
        key={cardId}
        style={{ width: isNarrowScreen ? '100%' : 180, flex: '0 0 auto', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}
        onClick={() => setCardModal(cardId)}
      >
        <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={info?.src} alt="card" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#111827',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: isNarrowScreen ? '-webkit-box' : 'block',
            WebkitLineClamp: isNarrowScreen ? 2 : (undefined as any),
            WebkitBoxOrient: isNarrowScreen ? ('vertical' as any) : (undefined as any),
            whiteSpace: isNarrowScreen ? 'normal' : 'nowrap',
            lineHeight: isNarrowScreen ? 1.2 : undefined,
            minHeight: isNarrowScreen ? 28 : undefined,
          }}
        >
          {info?.title}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
          {users.map(u => {
            const style = categoryChipStyle[u.category] || categoryChipStyle.neutral;
            return (
              <div key={u.userId} style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, borderRadius: 9999, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>{u.userName}</div>
            );
          })}
        </div>
      </div>
    );
  };

  const openGo = isNarrowScreen ? true : !!expanded.go;
  const openNo = isNarrowScreen ? true : !!expanded.no;
  const openNeutral = isNarrowScreen ? true : !!expanded.neutral;
  const openVs = isNarrowScreen ? true : !!expanded.vs;

  return (
    <div style={{ minHeight: '100dvh', background: '#ffffff', padding: `calc(env(safe-area-inset-top, 0px) + 20px) ${isNarrowScreen ? 10 : 12}px calc(env(safe-area-inset-bottom, 0px) + 20px)`, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* ヘッダー行 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', width: isNarrowScreen ? '100%' : 'auto' }}>
            <button 
              onClick={() => setAllCardsModalOpen(true)}
              style={{ 
                padding: isNarrowScreen ? '10px 14px' : '12px 24px', 
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                border: 'none',
                borderRadius: 12, 
                fontWeight: 800, 
                color: '#fff', 
                cursor: 'pointer',
                fontSize: isNarrowScreen ? 14 : 15,
                boxShadow: '0 8px 20px rgba(37, 99, 235, 0.3)',
                transition: 'all 0.2s ease',
                flex: isNarrowScreen ? '1 1 auto' : undefined,
              }}
              onMouseEnter={(e) => {
                if (isNarrowScreen) return;
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 12px 28px rgba(37, 99, 235, 0.4)';
              }}
              onMouseLeave={(e) => {
                if (isNarrowScreen) return;
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(37, 99, 235, 0.3)';
              }}
            >
              📋 全カード一覧
            </button>

            {isNarrowScreen && (
              <div
                style={
                  {
                    display: 'flex',
                    alignItems: 'stretch',
                    justifyContent: 'center',
                    '--map-btn-size': '44px',
                    '--map-btn-radius': '12px',
                  } as any
                }
                aria-label="マップ"
                title="マップ"
              >
                <MapButton variant="inline" showLabel={false} />
              </div>
            )}
          </div>
          {renderAvatars()}
        </div>

        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <h1 style={{ fontSize: isNarrowScreen ? 24 : 32, fontWeight: 900, letterSpacing: '.5px', margin: 0, color: '#0f172a' }}>最終結果</h1>
          <div style={{ marginTop: 8, color: '#475569', fontSize: 14 }}>参加者: {participantsSummary || '—'}</div>
          {/* 合致率表示を削除 */}
        </div>

        {/* 合致度サマリーエリア */}
        {matchAnalysis.length > 0 && (
          <div style={{ margin: '0 auto 32px', maxWidth: 900, background: 'linear-gradient(135deg,#f0fdf4,#ffffff)', border: '2px solid #10b981', borderRadius: 18, padding: '14px 18px', boxShadow: '0 6px 18px -8px rgba(16,185,129,0.15)' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#065f46', marginBottom: 12, letterSpacing: '.5px' }}>合致度サマリー</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {matchAnalysis.map((match) => {
                const userPairs = matchAnalysisPairs.filter(p => 
                  p.userAId === match.userId || p.userBId === match.userId
                );
                return (
                  <div key={match.userId} style={{ background: '#fff', border: '1px solid #6ee7b7', borderRadius: 12, padding: '12px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>{match.userName}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {userPairs.length > 0 ? (
                        userPairs.map((pair) => {
                          const otherName = pair.userAId === match.userId ? pair.userBName : pair.userAName;
                          return (
                            <div 
                              key={`${pair.userAId}_${pair.userBId}`}
                              style={{ 
                                background: '#f9fafb', 
                                border: '1px solid #d1d5db', 
                                borderRadius: 8, 
                                padding: '8px 12px',
                                fontSize: 12,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8
                              }}
                            >
                              <span style={{ fontWeight: 700, color: '#1f2937' }}>vs {otherName}</span>
                              <span style={{ fontWeight: 800, color: '#10b981' }}>＋{pair.plusCount}</span>
                              <span style={{ fontWeight: 800, color: '#9333ea' }}>−{pair.minusCount}</span>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>ペア情報なし</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: isNarrowScreen ? 16 : 28 }}>
          {/* 行く（柔らかい赤） */}
          <div style={{ border: '2px solid #fca5a5', background: '#fee2e2', borderRadius: 18, boxShadow: '0 10px 28px -10px rgba(252,165,165,0.5)' }}>
            <div
              onClick={() => {
                if (isNarrowScreen) return;
                setExpanded(e => ({ ...e, go: !expanded.go }));
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isNarrowScreen ? '12px 14px' : '12px 18px', cursor: isNarrowScreen ? 'default' : 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#991b1b' }}>行く</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', opacity: .9 }}>{uniqueSectionCards.go?.length || 0}枚</div>
              </div>
              {!isNarrowScreen && (
                <div style={{ transform: openGo ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#991b1b' }}>^</div>
              )}
            </div>
            <div style={{ height: openGo ? (isNarrowScreen ? 'auto' : 240) : 0, transition: isNarrowScreen ? 'none' : 'height .35s ease', overflow: openGo ? (isNarrowScreen ? 'visible' : 'hidden') : 'hidden', borderTop: openGo ? '1px solid rgba(252,165,165,0.4)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: isNarrowScreen ? '12px 12px 14px' : '10px 14px 20px' }}>
                <div
                  style={
                    isNarrowScreen
                      ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
                      : { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }
                  }
                >
                  {(uniqueSectionCards.go?.length || 0) > 0 ? uniqueSectionCards.go!.map(renderCard) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>カードなし</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 行かない（柔らかい青） */}
          <div style={{ border: '2px solid #93c5fd', background: '#eff6ff', borderRadius: 18, boxShadow: '0 10px 28px -10px rgba(147,197,253,0.5)' }}>
            <div
              onClick={() => {
                if (isNarrowScreen) return;
                setExpanded(e => ({ ...e, no: !expanded.no }));
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isNarrowScreen ? '12px 14px' : '12px 18px', cursor: isNarrowScreen ? 'default' : 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#1e40af' }}>行かない</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', opacity: .9 }}>{uniqueSectionCards.no?.length || 0}枚</div>
              </div>
              {!isNarrowScreen && (
                <div style={{ transform: openNo ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#1e40af' }}>^</div>
              )}
            </div>
            <div style={{ height: openNo ? (isNarrowScreen ? 'auto' : 240) : 0, transition: isNarrowScreen ? 'none' : 'height .35s ease', overflow: openNo ? (isNarrowScreen ? 'visible' : 'hidden') : 'hidden', borderTop: openNo ? '1px solid rgba(147,197,253,0.4)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: isNarrowScreen ? '12px 12px 14px' : '10px 14px 20px' }}>
                <div
                  style={
                    isNarrowScreen
                      ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
                      : { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }
                  }
                >
                  {(uniqueSectionCards.no?.length || 0) > 0 ? uniqueSectionCards.no!.map(renderCard) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#3b82f6' }}>カードなし</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* どちらでもいい（灰色） */}
          <div style={{ border: '2px solid #d1d5db', background: '#e5e7eb', borderRadius: 18, boxShadow: '0 10px 28px -10px rgba(107,114,128,0.25)' }}>
            <div
              onClick={() => {
                if (isNarrowScreen) return;
                setExpanded(e => ({ ...e, neutral: !expanded.neutral }));
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isNarrowScreen ? '12px 14px' : '12px 18px', cursor: isNarrowScreen ? 'default' : 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#374151' }}>どちらでもいい</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', opacity: .85 }}>{uniqueSectionCards.neutral?.length || 0}枚</div>
              </div>
              {!isNarrowScreen && (
                <div style={{ transform: openNeutral ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#374151' }}>^</div>
              )}
            </div>
            <div style={{ height: openNeutral ? (isNarrowScreen ? 'auto' : 240) : 0, transition: isNarrowScreen ? 'none' : 'height .35s ease', overflow: openNeutral ? (isNarrowScreen ? 'visible' : 'hidden') : 'hidden', borderTop: openNeutral ? '1px solid rgba(156,163,175,0.3)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: isNarrowScreen ? '12px 12px 14px' : '10px 14px 20px' }}>
                <div
                  style={
                    isNarrowScreen
                      ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
                      : { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }
                  }
                >
                  {(uniqueSectionCards.neutral?.length || 0) > 0 ? uniqueSectionCards.neutral!.map(renderCard) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>カードなし</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 議論中（VS）（柔らかい橙） */}
          <div style={{ border: '2px solid #fdba74', background: '#ffedd5', borderRadius: 18, boxShadow: '0 10px 28px -10px rgba(251,146,60,0.35)' }}>
            <div
              onClick={() => {
                if (isNarrowScreen) return;
                setExpanded(e => ({ ...e, vs: !expanded.vs }));
              }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isNarrowScreen ? '12px 14px' : '12px 18px', cursor: isNarrowScreen ? 'default' : 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#9a3412' }}>議論中（VS）</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#c2410c', opacity: .9 }}>{uniqueSectionCards.vs?.length || 0}枚</div>
              </div>
              {!isNarrowScreen && (
                <div style={{ transform: openVs ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#9a3412' }}>^</div>
              )}
            </div>
            <div style={{ height: openVs ? (isNarrowScreen ? 'auto' : 240) : 0, transition: isNarrowScreen ? 'none' : 'height .35s ease', overflow: openVs ? (isNarrowScreen ? 'visible' : 'hidden') : 'hidden', borderTop: openVs ? '1px solid rgba(253,186,116,0.45)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: isNarrowScreen ? '12px 12px 14px' : '10px 14px 20px' }}>
                <div
                  style={
                    isNarrowScreen
                      ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }
                      : { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }
                  }
                >
                  {(uniqueSectionCards.vs?.length || 0) > 0 ? uniqueSectionCards.vs!.map(renderCard) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#c2410c' }}>カードなし</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* 参加者情報モーダル */}
      {activeUserInfo && (() => {
        const user = participantStats.find(p => p.userId === activeUserInfo);
        if (!user) return null;
        const catOrder: Array<{key: keyof typeof user.counts; label: string}> = [{ key: 'want', label: '行きたい' }, { key: 'neutral', label: 'どちらでもいい' }, { key: 'dont', label: '行きたくない' }];
        const getList = (k: keyof typeof user.counts) => {
          const sel = selections.find(s => s.userId === user.userId);
          return sel ? sel.categories[k] : [];
        };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={closeUserInfoModal}>
            <div style={{ width: 'min(92vw, 420px)', maxHeight: '85dvh', overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e=>e.stopPropagation()}>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>{user.userName}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {catOrder.map(({key,label}) => {
                  const list = getList(key);
                  const categoryStyle = categoryChipStyle[key as string] || categoryChipStyle.neutral;
                  return (
                    <div key={key} style={{ border: `1px solid ${categoryStyle.border}`, borderRadius: 10, background: categoryStyle.bg }}>
                      <div 
                        onClick={() => setCategoryDetailModal({ userId: user.userId, category: key as string })} 
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', cursor: 'pointer' }}
                      >
                        <div style={{ color: categoryStyle.text, fontWeight: 700 }}>{label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontWeight: 800, color: categoryStyle.text }}>{list.length}</span>
                          <span style={{ color: categoryStyle.text }}>^</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ textAlign: 'right', marginTop: 12 }}>
                <button onClick={closeUserInfoModal} style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontWeight: 700 }}>閉じる</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 全カード一覧モーダル */}
      {allCardsModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }} onClick={() => setAllCardsModalOpen(false)}>
          <div style={{ width: 'min(95vw, 1200px)', maxHeight: '90vh', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 80px rgba(0,0,0,0.35)' }} onClick={e=>e.stopPropagation()}>
            <div style={{ padding: isNarrowScreen ? '16px 16px' : '24px 28px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #f0f9ff, #f8fafc)' }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: isNarrowScreen ? 18 : 24, color: '#0f172a', marginBottom: 4 }}>📋 全カード一覧</div>
                <div style={{ fontSize: isNarrowScreen ? 12 : 13, color: '#64748b' }}>全{allCardsWithFinalCategory.length}枚のカード、最終決定カテゴリと選択状況</div>
              </div>
              <button onClick={() => setAllCardsModalOpen(false)} style={{ padding: '8px 16px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontWeight: 700, color: '#374151', cursor: 'pointer' }}>閉じる</button>
            </div>
            <div style={{ padding: isNarrowScreen ? 14 : 20, overflowY: 'auto', maxHeight: 'calc(90vh - 80px)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: isNarrowScreen ? 'repeat(auto-fill, minmax(160px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                {allCardsWithFinalCategory.map(({ cardId, finalCategory, users }) => {
                  const info = getCardInfo(cardId);
                  const finalStyle = categoryChipStyle[finalCategory] || categoryChipStyle.unassigned;
                  return (
                    <div key={cardId} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                      <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                      <div style={{ padding: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                          <div style={{ fontWeight: 800, color: '#111827', fontSize: 12, lineHeight: 1.3, flex: 1 }}>{info?.title}</div>
                          <div style={{ background: finalStyle.bg, color: finalStyle.text, border: `1px solid ${finalStyle.border}`, borderRadius: 9999, padding: '2px 6px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {categoryNames[finalCategory]}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gap: 4 }}>
                          {users.length > 0 ? users.map(u => {
                            const style = categoryChipStyle[u.category] || categoryChipStyle.neutral;
                            return (
                              <div key={u.userId} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, gap: 4 }}>
                                  <div style={{ fontWeight: 700, fontSize: 10, color: '#111827' }}>{u.userName}</div>
                                  <div style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, borderRadius: 9999, padding: '1px 5px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                    {categoryNames[u.category]}
                                  </div>
                                </div>
                              </div>
                            );
                          }) : (
                            <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>誰も選択していません</div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* カテゴリ詳細モーダル */}
      {categoryDetailModal && (() => {
        const user = participantStats.find(p => p.userId === categoryDetailModal.userId);
        const selection = selections.find(s => s.userId === categoryDetailModal.userId);
        if (!user || !selection) return null;
        
        const categoryKey = categoryDetailModal.category as keyof typeof selection.categories;
        const categoryList = selection.categories[categoryKey] || [];
        const categoryStyle = categoryChipStyle[categoryDetailModal.category] || categoryChipStyle.neutral;
        const categoryName = categoryNames[categoryDetailModal.category] || categoryDetailModal.category;
        
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120 }} onClick={() => setCategoryDetailModal(null)}>
            <div style={{ width: 'min(95vw, 1000px)', maxHeight: '90vh', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 80px rgba(0,0,0,0.4)' }} onClick={e=>e.stopPropagation()}>
              <div style={{ 
                padding: '16px 20px', 
                borderBottom: `3px solid ${categoryStyle.border}`, 
                background: categoryStyle.bg,
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center' 
              }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 18, color: categoryStyle.text }}>{user.userName} - {categoryName}</div>
                  <div style={{ fontSize: 14, color: categoryStyle.text, opacity: 0.8 }}>{categoryList.length}枚のカード</div>
                </div>
                <button 
                  onClick={() => setCategoryDetailModal(null)} 
                  style={{ 
                    padding: '6px 12px', 
                    border: `1px solid ${categoryStyle.border}`, 
                    borderRadius: 8, 
                    background: '#fff', 
                    fontWeight: 700,
                    color: categoryStyle.text
                  }}
                >
                  閉じる
                </button>
              </div>
              <div style={{ padding: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 100px)' }}>
                {categoryList.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: isNarrowScreen ? 'repeat(auto-fill, minmax(160px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                    {categoryList.map((card, index) => {
                      const info = getCardInfo(card.id);
                      
                      return (
                        <div 
                          key={index} 
                          onClick={() => setExpandedCard({ id: card.id, flipped: false })}
                          style={{ 
                            border: `1px solid #e5e7eb`, 
                            borderRadius: 10, 
                            overflow: 'hidden', 
                            background: '#fff',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                            cursor: 'pointer',
                            transition: 'transform 0.2s, box-shadow 0.2s'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                          }}
                        >
                          <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          </div>
                          <div style={{ padding: 10 }}>
                            <div style={{ 
                              fontWeight: 800, 
                              fontSize: 12, 
                              color: '#111827', 
                              marginBottom: 6,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              gap: 6
                            }}>
                              <span style={{ lineHeight: 1.3 }}>{info?.title}</span>
                              <div style={{ 
                                background: categoryStyle.bg, 
                                color: categoryStyle.text, 
                                border: `1px solid ${categoryStyle.border}`, 
                                borderRadius: 9999, 
                                padding: '2px 6px', 
                                fontSize: 10, 
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                                flexShrink: 0
                              }}>
                                {categoryName}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '40px 20px', 
                    color: '#6b7280',
                    fontSize: 16 
                  }}>
                    このカテゴリにはカードがありません
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* カードモーダル */}
      {cardModal && (() => {
        const info = getCardInfo(cardModal);
        const users = cardChoiceMap[cardModal]?.users || [];
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
            <div style={{ width: 'min(92vw,720px)', background: '#fff', borderRadius: 18, boxShadow: '0 30px 80px -20px rgba(15,23,42,.4)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ width: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
                  <img src={info?.src} alt="card" style={{ width: '100%', height: 220, objectFit: 'contain' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12, color: '#0f172a' }}>{info?.title}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {users.map(u => {
                      const st = categoryChipStyle[u.category] || categoryChipStyle.neutral;
                      return (
                        <div key={u.userId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{u.userName}</div>
                            <div style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, borderRadius: 9999, padding: '2px 10px', fontSize: 12, fontWeight: 800 }}>{categoryNames[u.category] || u.category}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={{ padding: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={() => setCardModal(null)} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', fontWeight: 700, color: '#334155', cursor: 'pointer' }}>閉じる</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 拡大カードモーダル（3D回転） */}
      {expandedCard && (() => {
        const info = getCardInfo(expandedCard.id);
        return (
          <div 
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              backdropFilter: 'blur(4px)',
              zIndex: 200,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
            }}
            onClick={() => setExpandedCard(null)}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 16,
                padding: 20,
                maxWidth: 520,
                width: '100%',
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* カード表示エリア */}
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '3/2',
                  perspective: '1000px',
                  cursor: 'pointer',
                  marginBottom: 16,
                }}
                onClick={() => setExpandedCard(prev => prev ? { ...prev, flipped: !prev.flipped } : null)}
              >
                <div
                  style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    transition: 'transform 0.6s',
                    transformStyle: 'preserve-3d',
                    transform: expandedCard.flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  }}
                >
                  {/* 表面 */}
                  <div
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      backfaceVisibility: 'hidden',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#fff',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    }}
                  >
                    <img
                      src={info?.src}
                      alt={info?.title}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  {/* 裏面 */}
                  <div
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background: '#fff',
                      boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    }}
                  >
                    <img
                      src={`/pngs/back/USJ_${expandedCard.id.replace('card', '')}_back-1.png`}
                      alt={`${info?.title} 裏面`}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  {/* 回転インジケーター */}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 16,
                      right: 16,
                      width: 48,
                      height: 48,
                      background: 'rgba(0, 0, 0, 0.5)',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                      backdropFilter: 'blur(4px)',
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#fff"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ width: 24, height: 24 }}
                    >
                      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                    </svg>
                  </div>
                </div>
              </div>
              
              {/* カード情報 */}
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 20, color: '#111827' }}>
                  {info?.title}
                </div>
                <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
                  クリックで回転
                </div>
              </div>
              
              {/* 閉じるボタン */}
              <button
                onClick={() => setExpandedCard(null)}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#f3f4f6',
                  fontWeight: 700,
                  color: '#6b7280',
                  cursor: 'pointer',
                }}
              >
                閉じる
              </button>
            </div>
          </div>
        );
      })()}

      {!isNarrowScreen && <MapButton />}

    </div>
  );
}
