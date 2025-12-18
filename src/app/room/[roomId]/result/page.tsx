"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { agreementOverall, convertSelectionsToMatrix } from '../../../../utils/agreement-calculator';
import { db } from '../../../../../lib/firebase';
import { normalizeCategories } from '../../../../utils/normalizeCategories';
import MapButton from '@/components/MapButton';

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

// カード定義（play3 と揃える）
const allCards = Array.from({ length: 40 }, (_, i) => {
  const idx = i + 1;
  return {
    id: `card${idx}`,
    title: cardTitles[i],
    src: `/pngs/USJ_${idx}_surface-1.png`,
  };
});

type FinalSelectionDoc = {
  userId: string;
  userName?: string;
  planName?: string;
  categories: any;
};

 type CatItem = { id: string; reason?: string };
 type UserSelection = {
   userId: string;
   userName: string;
   planName: string;
   categories: {
     veryWant: CatItem[];
     want: CatItem[];
     neutral: CatItem[];
     dont: CatItem[];
     veryDont: CatItem[];
   };
 };

// 表示順
const SECTION_ORDER: Array<{ key: string; label: string; color: string; border: string; collapsible: boolean }> = [
  { key: 'go', label: '行く', color: '#fee2e2', border: '#fca5a5', collapsible: true },
  { key: 'no', label: '行かない', color: '#1e3a8a', border: '#60a5fa', collapsible: true },
  { key: 'veryWant', label: '特に行きたい', color: '#fecaca', border: '#fca5a5', collapsible: true },
  { key: 'want', label: '行きたい', color: '#fce7f3', border: '#fbcfe8', collapsible: true },
  { key: 'neutral', label: 'どちらでもいい', color: '#e5e7eb', border: '#d1d5db', collapsible: true },
  { key: 'dont', label: '行きたくない', color: '#bae6fd', border: '#93c5fd', collapsible: true },
  { key: 'veryDont', label: '特に行きたくない', color: '#93c5fd', border: '#60a5fa', collapsible: true },
];

export default function ResultPage() {
  const { roomId } = useParams();
  const [selections, setSelections] = useState<UserSelection[]>([]);
  const [goIds, setGoIds] = useState<string[]>([]);
  const [noIds, setNoIds] = useState<string[]>([]);
  const [neutralIds, setNeutralIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cardModal, setCardModal] = useState<string | null>(null);
  const [overallAgreement, setOverallAgreement] = useState<number>(0);
  const [activeUserInfo, setActiveUserInfo] = useState<string | null>(null);
  const [userInfoExpanded, setUserInfoExpanded] = useState<Record<string, boolean>>({});
  const [allCardsModalOpen, setAllCardsModalOpen] = useState(false);
  const [categoryDetailModal, setCategoryDetailModal] = useState<{ userId: string; category: string } | null>(null);

  // 初期: go/no/neutralだけ展開
  useEffect(() => {
    setExpanded({ go: true, no: true, neutral: true });
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
         list.push({
           userId: data.userId || d.id,
           userName: data.userName || data.userId || d.id,
           planName: data.planName || 'プラン名未設定',
           categories: {
             veryWant: (norm.veryWant || []).map((c: any) => ({ id: c.id, reason: c.reason })),
             want: (norm.want || []).map((c: any) => ({ id: c.id })),
             neutral: (norm.neutral || []).map((c: any) => ({ id: c.id })),
             dont: (norm.dont || []).map((c: any) => ({ id: c.id })),
             veryDont: (norm.veryDont || []).map((c: any) => ({ id: c.id, reason: c.reason })),
           }
         });
      });
      console.log('Processed selections:', list); // デバッグログ
      setSelections(list);
    });
    return () => unsub();
  }, [roomId]);

  // play3Assignments 購読（go/no/neutralの最終決定）
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const qAssign = query(collection(db, 'rooms', roomId, 'play3Assignments'));
    const unsub = onSnapshot(qAssign, snap => {
      const go: string[] = []; const no: string[] = []; const neutral: string[] = [];
      snap.docs.forEach(d => {
        const data: any = d.data();
        if (data?.status === 'go') go.push(d.id);
        else if (data?.status === 'no') no.push(d.id);
        else if (data?.status === 'neutral') neutral.push(d.id);
      });
      setGoIds(go); setNoIds(no); setNeutralIds(neutral);
    });
    return () => unsub();
  }, [roomId]);

  // カード→ユーザー選択逆引きマップ
  const cardChoiceMap = useMemo(() => {
    type Entry = { userId: string; userName: string; planName: string; category: string; reason?: string };
    const map: Record<string, { users: Entry[] }> = {};
    selections.forEach(sel => {
      (Object.entries(sel.categories) as [string, CatItem[]][]).forEach(([cat, arr]) => {
        arr.forEach(item => {
          if (!map[item.id]) map[item.id] = { users: [] };
          map[item.id].users.push({ userId: sel.userId, userName: sel.userName, planName: sel.planName, category: cat, reason: item.reason });
        });
      });
    });
    return map;
  }, [selections]);

  // 各セクション表示用カード（go/no/neutralに基づく最終決定を最優先表示）
  const sectionCards = useMemo(() => {
    return { go: goIds, no: noIds, neutral: neutralIds };
  }, [goIds, noIds, neutralIds]);
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
  const planSummaryList = useMemo(() => selections.map(s => ({ user: s.userName, plan: s.planName })), [selections]);

  // 参加者のカテゴリ別カード数を計算
  const participantStats = useMemo(() => {
    return selections.map(sel => ({
      userId: sel.userId,
      userName: sel.userName,
      planName: sel.planName,
      counts: {
        veryWant: sel.categories.veryWant.length,
        want: sel.categories.want.length,
        neutral: sel.categories.neutral.length,
        dont: sel.categories.dont.length,
        veryDont: sel.categories.veryDont.length,
      }
    }));
  }, [selections]);

  // 全カード一覧のため、全カードに対する最終カテゴリを決定
  const allCardsWithFinalCategory = useMemo(() => {
    const ALL_CARDS = Array.from({ length: 40 }, (_, i) => `card${i + 1}`);
    return ALL_CARDS.map(cardId => {
      let finalCategory = 'unassigned';
      if (goIds.includes(cardId)) finalCategory = 'go';
      else if (noIds.includes(cardId)) finalCategory = 'no';
      else if (neutralIds.includes(cardId)) finalCategory = 'neutral';
      
      const users = cardChoiceMap[cardId]?.users || [];
      return { cardId, finalCategory, users };
    }).sort((a, b) => {
      // カード番号順にソート（card1, card2, card3...）
      const numA = parseInt(a.cardId.replace('card', ''), 10);
      const numB = parseInt(b.cardId.replace('card', ''), 10);
      return numA - numB;
    });
  }, [goIds, noIds, neutralIds, cardChoiceMap]);

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
        veryWant: s.categories.veryWant,
        want: s.categories.want,
        neutral: s.categories.neutral,
        dont: s.categories.dont,
        veryDont: s.categories.veryDont,
      }
    }));
    const matrix = convertSelectionsToMatrix(pseudo as any, 40);
    const overall = agreementOverall(matrix);
    setOverallAgreement(overall);
  }, [selections]);

  const categoryChipStyle: Record<string, { bg: string; text: string; border: string }> = {
    veryWant: { bg: '#fecaca', text: '#7f1d1d', border: '#fca5a5' },
    want: { bg: '#fce7f3', text: '#9d174d', border: '#fbcfe8' },
    neutral: { bg: '#e5e7eb', text: '#374151', border: '#d1d5db' },
    dont: { bg: '#bae6fd', text: '#0c4a6e', border: '#93c5fd' },
    veryDont: { bg: '#93c5fd', text: '#1e3a8a', border: '#60a5fa' },
    go: { bg: '#fecaca', text: '#991b1b', border: '#fca5a5' },      // 柔らかい赤
    no: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },      // 柔らかい青
    unassigned: { bg: '#f3f4f6', text: '#6b7280', border: '#d1d5db' },
  };

  const categoryNames: Record<string, string> = {
    veryWant: '特に行きたい',
    want: '行きたい',
    neutral: 'どちらでもいい',
    dont: '行きたくない',
    veryDont: '特に行きたくない',
    go: '行く',
    no: '行かない',
    unassigned: '未分類',
  };

  // アバター表示
  const renderAvatars = () => (
    <div style={{ display: 'flex', gap: 8 }}>
      {participantStats.map(p => (
        <button key={p.userId} onClick={() => setActiveUserInfo(p.userId)} title={p.userName} style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #e5e7eb', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,0.08)', fontWeight: 800, color: '#111827' }}>
          {p.userName?.[0] || '?'}
        </button>
      ))}
    </div>
  );

  const renderCard = (cardId: string) => {
    const info = getCardInfo(cardId);
    const users = cardChoiceMap[cardId]?.users || [];
    return (
      <div key={cardId} style={{ width: 200, flex: '0 0 auto', border: '1px solid #e5e7eb', background: '#fff', borderRadius: 14, padding: 8, boxShadow: '0 4px 10px -4px rgba(15,23,42,0.15)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }} onClick={() => setCardModal(cardId)}>
        <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={info?.src} alt="card" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{info?.title}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {users.map(u => {
            const style = categoryChipStyle[u.category] || categoryChipStyle.neutral;
            return (
              <div key={u.userId} style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, borderRadius: 9999, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>{u.userName}</div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#ffffff', padding: '32px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* ヘッダー行 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button 
            onClick={() => setAllCardsModalOpen(true)}
            style={{ padding: '8px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, color: '#374151', cursor: 'pointer' }}
          >
            全カード一覧
          </button>
          {renderAvatars()}
        </div>

        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: '.5px', margin: 0, color: '#0f172a' }}>最終結果</h1>
          <div style={{ marginTop: 8, color: '#475569', fontSize: 14 }}>参加者: {participantsSummary || '—'}</div>
          <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, backgroundImage: 'linear-gradient(135deg,#0ea5e9,#2563eb,#4f46e5)', WebkitBackgroundClip: 'text', color: 'transparent' }}>合致率 {overallAgreement.toFixed(0)}%</div>
        </div>

        {/* プラン一覧エリア */}
        <div style={{ margin: '0 auto 32px', maxWidth: 900, background: 'linear-gradient(135deg,#f8fafc,#ffffff)', border: '1px solid #e2e8f0', borderRadius: 18, padding: '14px 18px', boxShadow: '0 6px 18px -8px rgba(15,23,42,0.15)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 6, letterSpacing: '.5px' }}>各ユーザーのプラン名</div>
          {planSummaryList.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {planSummaryList.map((p, index) => (
                <div key={`${p.user}-${index}`} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9999, padding: '4px 14px', fontSize: 12, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{p.user}</span>
                  <span style={{ color: (p.plan && p.plan !== 'プラン名未設定') ? '#475569' : '#94a3b8' }}>
                    {(p.plan && p.plan !== 'プラン名未設定') ? p.plan : '—'}
                  </span>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 12, color: '#64748b' }}>データなし</div>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* 行く（柔らかい赤） */}
          <div style={{ border: '2px solid #fca5a5', background: '#fee2e2', borderRadius: 18, boxShadow: '0 10px 28px -10px rgba(252,165,165,0.5)' }}>
            <div
              onClick={() => setExpanded(e => ({ ...e, go: !expanded.go }))}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#991b1b' }}>行く</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', opacity: .9 }}>{uniqueSectionCards.go?.length || 0}枚</div>
              </div>
              <div style={{ transform: expanded.go ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#991b1b' }}>^</div>
            </div>
            <div style={{ height: expanded.go ? 240 : 0, transition: 'height .35s ease', overflow: 'hidden', borderTop: expanded.go ? '1px solid rgba(252,165,165,0.4)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 14px 20px' }}>
                <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
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
              onClick={() => setExpanded(e => ({ ...e, no: !expanded.no }))}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#1e40af' }}>行かない</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#3b82f6', opacity: .9 }}>{uniqueSectionCards.no?.length || 0}枚</div>
              </div>
              <div style={{ transform: expanded.no ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#1e40af' }}>^</div>
            </div>
            <div style={{ height: expanded.no ? 240 : 0, transition: 'height .35s ease', overflow: 'hidden', borderTop: expanded.no ? '1px solid rgba(147,197,253,0.4)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 14px 20px' }}>
                <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
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
              onClick={() => setExpanded(e => ({ ...e, neutral: !expanded.neutral }))}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, fontSize: 18, color: '#374151' }}>どちらでもいい</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', opacity: .85 }}>{uniqueSectionCards.neutral?.length || 0}枚</div>
              </div>
              <div style={{ transform: expanded.neutral ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: '#374151' }}>^</div>
            </div>
            <div style={{ height: expanded.neutral ? 240 : 0, transition: 'height .35s ease', overflow: 'hidden', borderTop: expanded.neutral ? '1px solid rgba(156,163,175,0.3)' : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '10px 14px 20px' }}>
                <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
                  {(uniqueSectionCards.neutral?.length || 0) > 0 ? uniqueSectionCards.neutral!.map(renderCard) : (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>カードなし</div>
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
        const catOrder: Array<{key: keyof typeof user.counts; label: string}> = [
          { key: 'veryWant', label: '特に行きたい' },
          { key: 'want', label: '行きたい' },
          { key: 'neutral', label: 'どちらでもいい' },
          { key: 'dont', label: '行きたくない' },
          { key: 'veryDont', label: '特に行きたくない' },
        ];
        const getList = (k: keyof typeof user.counts) => {
          const sel = selections.find(s => s.userId === user.userId);
          return sel ? sel.categories[k] : [];
        };
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={closeUserInfoModal}>
            <div style={{ width: 420, background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }} onClick={e=>e.stopPropagation()}>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>{user.userName}</div>
              <div style={{ color: '#374151', marginBottom: 10 }}>プラン名：<strong style={{ color: '#2563eb' }}>
                {(user.planName && user.planName !== 'プラン名未設定') ? user.planName : '—'}
              </strong></div>
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
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 900, fontSize: 20 }}>全カード一覧</div>
              <button onClick={() => setAllCardsModalOpen(false)} style={{ padding: '6px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', fontWeight: 700 }}>閉じる</button>
            </div>
            <div style={{ padding: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 80px)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {allCardsWithFinalCategory.map(({ cardId, finalCategory, users }) => {
                  const info = getCardInfo(cardId);
                  const finalStyle = categoryChipStyle[finalCategory] || categoryChipStyle.unassigned;
                  return (
                    <div key={cardId} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                      <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ fontWeight: 800, color: '#0f172a' }}>{info?.title}</div>
                          <div style={{ background: finalStyle.bg, color: finalStyle.text, border: `1px solid ${finalStyle.border}`, borderRadius: 9999, padding: '2px 8px', fontSize: 11, fontWeight: 800 }}>
                            {categoryNames[finalCategory]}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                          {users.length > 0 ? users.map(u => {
                            const style = categoryChipStyle[u.category] || categoryChipStyle.neutral;
                            const showReason = u.reason && (u.category === 'veryWant' || u.category === 'veryDont');
                            return (
                              <div key={u.userId} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                  <div style={{ fontWeight: 700, fontSize: 12, color: '#0f172a' }}>{u.userName}</div>
                                  <div style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, borderRadius: 9999, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
                                    {categoryNames[u.category]}
                                  </div>
                                </div>
                                {showReason && (
                                  <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.3 }}>
                                    理由: {u.reason || '（なし）'}
                                  </div>
                                )}
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
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                    {categoryList.map((card, index) => {
                      const info = getCardInfo(card.id);
                      const reason = (card as any).reason || '';
                      const showReason = reason && (categoryDetailModal.category === 'veryWant' || categoryDetailModal.category === 'veryDont');
                      
                      return (
                        <div key={index} style={{ 
                          border: `2px solid ${categoryStyle.border}`, 
                          borderRadius: 12, 
                          overflow: 'hidden', 
                          background: '#fff',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}>
                          <div style={{ width: '100%', aspectRatio: '3/2', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={info?.src} alt={info?.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                          <div style={{ padding: 12 }}>
                            <div style={{ 
                              fontWeight: 800, 
                              fontSize: 16, 
                              color: '#0f172a', 
                              marginBottom: 8,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center'
                            }}>
                              <span>{info?.title}</span>
                              <div style={{ 
                                background: categoryStyle.bg, 
                                color: categoryStyle.text, 
                                border: `1px solid ${categoryStyle.border}`, 
                                borderRadius: 9999, 
                                padding: '2px 8px', 
                                fontSize: 11, 
                                fontWeight: 800 
                              }}>
                                {categoryName}
                              </div>
                            </div>
                            {showReason && (
                              <div style={{ 
                                background: '#f8fafc', 
                                border: '1px solid #e2e8f0', 
                                borderRadius: 8, 
                                padding: 8,
                                marginTop: 8
                              }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 4 }}>理由:</div>
                                <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.4 }}>
                                  {reason || '（理由なし）'}
                                </div>
                              </div>
                            )}
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
              <div style={{ display: 'flex', gap: 20, padding: 20, borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ flex: '0 0 240px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
                  <img src={info?.src} alt="card" style={{ width: '100%', height: 180, objectFit: 'cover' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 20, marginBottom: 12, color: '#0f172a' }}>{info?.title}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {users.map(u => {
                      const st = categoryChipStyle[u.category] || categoryChipStyle.neutral;
                      const showReason = u.reason && (u.category === 'veryWant' || u.category === 'veryDont');
                      return (
                        <div key={u.userId} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{u.userName}</div>
                            <div style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, borderRadius: 9999, padding: '2px 10px', fontSize: 12, fontWeight: 800 }}>{categoryNames[u.category] || u.category}</div>
                          </div>
                          <div style={{ fontSize: 12, color: showReason ? '#334155' : '#94a3b8', fontWeight: 600, lineHeight: 1.4 }}>
                            {showReason ? (u.reason || '') : '（理由なし / 特に系以外）'}
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

      <MapButton />
    </div>
  );
}
