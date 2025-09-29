"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { collection, doc, onSnapshot, query } from 'firebase/firestore';
import { agreementOverall, convertSelectionsToMatrix } from '../../../../utils/agreement-calculator';
import { db } from '../../../../../lib/firebase';
import { normalizeCategories } from '../../../../utils/normalizeCategories';

// カード定義（play3 と揃える）
const allCards = Array.from({ length: 40 }, (_, i) => {
  const idx = i + 1;
  return {
    id: `card${idx}`,
    title: `カード${idx}`,
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
  const [notGoIds, setNotGoIds] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cardModal, setCardModal] = useState<string | null>(null);
  const [overallAgreement, setOverallAgreement] = useState<number>(0);

  // 初期: 全セクション展開 (後で行く/行かないだけ展開し他は閉じるも可)
  useEffect(() => {
    const init: Record<string, boolean> = {};
    SECTION_ORDER.forEach(s => { init[s.key] = s.key === 'go' || s.key === 'no'; });
    setExpanded(init);
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
         list.push({
           userId: data.userId || d.id,
           userName: data.userName || data.userId || d.id,
           planName: data.planName || '',
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
    });
    return () => unsub();
  }, [roomId]);

  // go/no 購読
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const colRef = collection(db, 'rooms', roomId, 'goNo');
    const unsub = onSnapshot(colRef, snap => {
      const go: string[] = []; const no: string[] = [];
      snap.docs.forEach(d => { const data: any = d.data(); if (data.status === 'go') go.push(d.id); else if (data.status === 'no') no.push(d.id); });
      setGoIds(go); setNotGoIds(no);
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

  // 各セクション表示用カード（go/no に加えて veryWant, want, dont, veryDont 間の重複を排除）
  const sectionCards = useMemo(() => {
    const decidedSet = new Set([...goIds, ...notGoIds]);
    const rawVeryWant = new Set<string>();
    const rawWant = new Set<string>();
    const rawNeutral = new Set<string>();
    const rawDont = new Set<string>();
    const rawVeryDont = new Set<string>();
    selections.forEach(sel => {
      sel.categories.veryWant.forEach(c => rawVeryWant.add(c.id));
      sel.categories.want.forEach(c => rawWant.add(c.id));
      sel.categories.neutral.forEach(c => rawNeutral.add(c.id));
      sel.categories.dont.forEach(c => rawDont.add(c.id));
      sel.categories.veryDont.forEach(c => rawVeryDont.add(c.id));
    });
    // 優先順位: veryWant > want > dont > veryDont > neutral
    const assigned = new Set<string>();
    const veryWant: string[] = [];
    const want: string[] = [];
    const dont: string[] = [];
    const veryDont: string[] = [];
    const neutral: string[] = [];
    const considerIds = new Set<string>([...rawVeryWant, ...rawWant, ...rawDont, ...rawVeryDont, ...rawNeutral]);
    considerIds.forEach(id => {
      if (decidedSet.has(id)) return; // go/no に入ったカードは除外
      if (rawVeryWant.has(id)) { veryWant.push(id); assigned.add(id); return; }
      if (rawWant.has(id)) { want.push(id); assigned.add(id); return; }
      if (rawDont.has(id)) { dont.push(id); assigned.add(id); return; }
      if (rawVeryDont.has(id)) { veryDont.push(id); assigned.add(id); return; }
      if (rawNeutral.has(id)) { neutral.push(id); assigned.add(id); return; }
    });
    return { go: goIds, no: notGoIds, veryWant, want, neutral, dont, veryDont };
  }, [selections, goIds, notGoIds]);
  const uniqueSectionCards = useMemo(() => {
    const r: Record<string, string[]> = {};
    Object.entries(sectionCards).forEach(([k, arr]) => {
      const seen = new Set<string>();
      r[k] = [];
      arr.forEach(id => { if (!seen.has(id)) { seen.add(id); r[k].push(id); } });
    });
    return r;
  }, [sectionCards]);
  const participantsSummary = useMemo(() => selections.map(s => s.userName).join('・'), [selections]);
  const planSummaryList = useMemo(() => selections.map(s => ({ user: s.userName, plan: s.planName })), [selections]);

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
    go: { bg: '#ef4444', text: '#fff', border: '#b91c1c' },
    no: { bg: '#1e3a8a', text: '#fff', border: '#334155' },
  };

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
              {planSummaryList.map(p => (
                <div key={p.user} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 9999, padding: '4px 14px', fontSize: 12, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{p.user}</span>
                  <span style={{ color: p.plan ? '#475569' : '#94a3b8' }}>{p.plan || '—'}</span>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 12, color: '#64748b' }}>データなし</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {SECTION_ORDER.map(section => {
            const cards = uniqueSectionCards[section.key] || [];
            const open = expanded[section.key];
            return (
              <div key={section.key} style={{ border: `1px solid ${section.border}`, background: section.key==='no' ? 'linear-gradient(180deg,#1e3a8a,#1e40af)' : section.color, borderRadius: 18, boxShadow: '0 10px 28px -10px rgba(15,23,42,0.25)' }}>
                <div
                  onClick={() => setExpanded(e => ({ ...e, [section.key]: !open }))}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontWeight: 900, fontSize: 18, color: section.key==='no' ? '#fff' : '#0f172a' }}>{section.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: section.key==='no' ? '#e0f2fe' : '#334155', opacity: .85 }}>{cards.length}枚</div>
                  </div>
                  <div style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .25s', fontSize: 20, color: section.key==='no' ? '#fff' : '#334155' }}>^</div>
                </div>
                <div style={{ height: open ? 240 : 0, transition: 'height .35s ease', overflow: 'hidden', borderTop: open ? '1px solid rgba(255,255,255,0.3)' : 'none', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '10px 14px 20px' }}>
                    <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 6 }}>
                      {cards.length ? cards.map(renderCard) : (
                        <div style={{ fontSize: 13, fontWeight: 600, color: section.key==='no' ? '#bfdbfe' : '#475569' }}>カードなし</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
                            <div style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, borderRadius: 9999, padding: '2px 10px', fontSize: 12, fontWeight: 800 }}>{SECTION_ORDER.find(s => s.key === u.category)?.label || u.category}</div>
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
    </div>
  );
}
