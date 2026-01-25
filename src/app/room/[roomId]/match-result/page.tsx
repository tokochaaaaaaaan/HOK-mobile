"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { collection, query, onSnapshot, setDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { cards } from "../../../../data/cards";

// ================= Types =================

type UserSelection = {
  user: string;
  userId: string;
  userName: string;
  planName?: string;
  categories: {
    veryWant: Array<{ id: string; reason?: string }>;
    want: Array<{ id: string; reason?: string }>;
    neutral: Array<{ id: string; reason?: string }>;
    dont: Array<{ id: string; reason?: string }>;
    veryDont: Array<{ id: string; reason?: string }>;
  };
};

// Confetti animation removed for performance

// ================= Main Page =================

export default function MatchResultPage() {
  const params = useParams();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const router = useRouter();
  usePreventBack();

  console.log('MatchResultPage initialized with:', { roomId, params });

  // Audio refs
  const drumrollRef = useRef<HTMLAudioElement>(null);
  const banRef = useRef<HTMLAudioElement>(null);

  // 演出フェーズ: 集計(waiting) -> アナウンス(announce) -> ドラムロール(drumroll) -> リビール(reveal)
  type Phase = 'waiting' | 'announce' | 'drumroll' | 'reveal';
  const [phase, setPhase] = useState<Phase>('waiting');
  // 合致度集計完了フラグ
  const [agreementReady, setAgreementReady] = useState(false);

  // Data states
  const [userSelections, setUserSelections] = useState<UserSelection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  type PairDetail = {
    otherUserId: string;
    otherUserName: string;
    plusCount: number; // 同符号（+/+ または -/-）
    minusCount: number; // 異符号（+/-）
    matchedTitles: string[];
    unmatchedTitles: string[];
    matchedIds: number[];
    unmatchedIds: number[];
  };
  type ParticipantSummary = {
    userId: string;
    userName: string;
    pairs: PairDetail[];
    plusSum: number;
    minusSum: number;
  };
  const [participantSummaries, setParticipantSummaries] = useState<ParticipantSummary[]>([]);
  
  // カード詳細モーダル用
  const [detailModal, setDetailModal] = useState<{ show: boolean; userA: string; userB: string; pair: PairDetail | null }>({ show: false, userA: '', userB: '', pair: null });

  // ========== Data Subscription ==========
  useEffect(() => {
    console.log('Match result: useEffect triggered', { roomId, roomIdType: typeof roomId });
    if (!roomId || typeof roomId !== "string") {
      console.log('Match result: Invalid roomId, returning');
      return;
    }
    
    console.log('Match result: Setting up finalSelections subscription for roomId:', roomId);
    // finalSelections コレクション から集計ソースを取得
    const q = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsub = onSnapshot(q, (snapshot) => {
      console.log('Match result: finalSelections snapshot received', { 
        empty: snapshot.empty, 
        size: snapshot.size,
        docs: snapshot.docs.map(d => ({ id: d.id, exists: d.exists() }))
      });
      
      if (snapshot.empty) {
        console.log('No finalSelections documents found yet for match-result');
        setUserSelections([]);
        setIsLoading(false);
        return;
      }
      
      const list: UserSelection[] = [];
      const processingErrors: string[] = [];
      
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        console.log('Match result: Processing finalSelections doc:', { 
          docId: doc.id, 
          data,
          hasCategories: !!data.categories,
          isReady: !!data.isReady,
          hasWant: !!data.want,
          hasDont: !!data.dont
        });
        
        // waitingページで確定したデータのみを使用
        if (!data.isReady) {
          console.log('Match result: Skipping non-ready user:', doc.id);
          return;
        }
        
        try {
          // 統一フォーマット優先: categories フィールドを使用
          if (data.categories) {
            list.push({
              user: data.user || data.userId || data.userName || doc.id,
              userId: data.userId || data.user || data.userName || doc.id,
              userName: data.userName || data.user || data.userId || doc.id,
              planName: data.planName || data.planname || "",
              categories: data.categories,
            });
          } else if (data.verywant || data.verydont || data.want || data.dont) {
            // 旧形式: verywant/verydont/want/dont フィールドから構築
            const categories = {
              veryWant: (data.verywant || []).map((item: any) => 
                typeof item === 'string' ? { id: item } : item
              ),
              want: (data.want || []).map((id: string) => ({ id })),
              neutral: (data.neutral || []).map((id: string) => ({ id })),
              dont: (data.dont || []).map((id: string) => ({ id })),
              veryDont: (data.verydont || []).map((item: any) => 
                typeof item === 'string' ? { id: item } : item
              ),
            };
            
            list.push({
              user: data.user || data.userId || doc.id,
              userId: data.userId || data.user || doc.id,
              userName: data.userName || data.user || doc.id,
              planName: data.planName || data.planname || "",
              categories,
            });
          } else {
            // データ不足の場合は空のカテゴリで追加
            console.warn('Match result: No valid category data found for user:', doc.id);
            list.push({
              user: data.user || data.userId || doc.id,
              userId: data.userId || data.user || doc.id,
              userName: data.userName || data.user || doc.id,
              planName: data.planName || data.planname || "",
              categories: {
                veryWant: [],
                want: [],
                neutral: [],
                dont: [],
                veryDont: [],
              },
            });
          }
        } catch (error) {
          console.error('Match result: Error processing document:', doc.id, error);
          processingErrors.push(`${doc.id}: ${error}`);
        }
      });
      
      if (processingErrors.length > 0) {
        console.warn('Match result: Some documents had processing errors:', processingErrors);
      }
      
      console.log('Match result: Final user selections:', list);
      setUserSelections(list);
      setIsLoading(false);
    });
    
    return () => unsub();
  }, [roomId]);

  // 集計完了したらアナウンスフェーズへ
  useEffect(() => {
    console.log('Match result: Phase transition check', { phase, agreementReady });
    if (phase === 'waiting' && agreementReady) {
      console.log('Match result: Transitioning from waiting to announce');
      // 少し溜めてからテキスト表示
      const t = setTimeout(() => {
        console.log('Match result: Setting phase to announce');
        setPhase('announce');
      }, 600);
      return () => clearTimeout(t);
    }
  }, [phase, agreementReady]);

  // ========== Agreement Calculations (sum-based) ==========
  useEffect(() => {
    console.log('Match result: Sum-based agreement calculation triggered', { userSelectionsLength: userSelections.length, userSelections });
    if (userSelections.length === 0) {
      console.log('Match result: No user selections, skipping calculation');
      return;
    }
    // 最低限の参加者数チェック
    if (userSelections.length < 2) {
      console.log('Match result: Less than 2 participants, nothing to compare');
      setParticipantSummaries(userSelections.map(u => ({ userId: u.userId, userName: u.userName, pairs: [], plusSum: 0, minusSum: 0 })));
      setAgreementReady(true);
      return;
    }

    // データの有効性チェック：全参加者のカテゴリデータが存在するか確認
    const validSelections = userSelections.filter(selection => {
      const hasValidCategories = selection.categories && 
        typeof selection.categories === 'object' &&
        Object.keys(selection.categories).length > 0;
      
      if (!hasValidCategories) {
        console.log('Match result: Invalid categories for user:', selection.userName || selection.userId);
      }
      
      return hasValidCategories;
    });

    // 有効なデータが不足している場合は計算を延期
    if (validSelections.length !== userSelections.length) {
      console.log('Match result: Waiting for all user data to be valid', { 
        total: userSelections.length, 
        valid: validSelections.length 
      });
      return;
    }

    // 一意性チェック：同じユーザーの重複データを除去
    const uniqueSelections = validSelections.reduce((acc, current) => {
      const existing = acc.find(item => 
        item.userId === current.userId || 
        item.userName === current.userName ||
        item.user === current.user
      );
      
      if (!existing) {
        acc.push(current);
      }
      
      return acc;
    }, [] as UserSelection[]);

    console.log('Match result: Using unique selections for calculation:', { 
      original: userSelections.length,
      valid: validSelections.length,
      unique: uniqueSelections.length,
      users: uniqueSelections.map(s => s.userName || s.userId || s.user)
    });

    (async () => {
      try {
      // カードIDを数値化した一覧（title取得のため）
      const idToCard = new Map<number, { title: string; frontSrc: string }>();
      cards.forEach(c => idToCard.set(c.id, { title: c.title, frontSrc: c.frontSrc }));

      // ユーザーごとの符号マップ（cardId -> -1 | 0 | +1）
      const userSignMaps = uniqueSelections.map(sel => {
        const signMap = new Map<number, number>();
        const toNum = (arr: Array<{id: string}>) => arr.map(x => Number(x.id)).filter(n => !Number.isNaN(n));
        toNum(sel.categories.veryWant).forEach(id => signMap.set(id, +1));
        toNum(sel.categories.want).forEach(id => signMap.set(id, +1));
        toNum(sel.categories.neutral).forEach(id => signMap.set(id, 0));
        toNum(sel.categories.dont).forEach(id => signMap.set(id, -1));
        toNum(sel.categories.veryDont).forEach(id => signMap.set(id, -1));
        return { userId: sel.userId, userName: sel.userName, signMap };
      });

      // 参加者ごとのサマリー構築
      const summaries: ParticipantSummary[] = userSignMaps.map(u => ({ userId: u.userId, userName: u.userName, pairs: [], plusSum: 0, minusSum: 0 }));

      // 全カードIDリスト（1..N）
      const allCardIds = cards.map(c => c.id);

      // ペア別に集計
      for (let i = 0; i < userSignMaps.length; i++) {
        for (let j = i + 1; j < userSignMaps.length; j++) {
          const A = userSignMaps[i];
          const B = userSignMaps[j];
          let plus = 0;
          let minus = 0;
          const matchedTitles: string[] = [];
          const unmatchedTitles: string[] = [];
          const matchedIds: number[] = [];
          const unmatchedIds: number[] = [];

          for (const cardId of allCardIds) {
            const a = A.signMap.get(cardId);
            const b = B.signMap.get(cardId);
            if (a == null || b == null) continue; // どちらかが未選択なら対象外
            if (a === 0 || b === 0) continue; // ニュートラルはいずれの場合も加算しない
            if (a === b) {
              plus++;
              const c = idToCard.get(cardId);
              if (c) {
                matchedTitles.push(c.title);
                matchedIds.push(cardId);
              }
            } else if (a * b === -1) {
              minus++;
              const c = idToCard.get(cardId);
              if (c) {
                unmatchedTitles.push(c.title);
                unmatchedIds.push(cardId);
              }
            }
          }

          // i側にペアを追加
          summaries[i].pairs.push({
            otherUserId: B.userId,
            otherUserName: B.userName,
            plusCount: plus,
            minusCount: minus,
            matchedTitles,
            unmatchedTitles,
            matchedIds,
            unmatchedIds,
          });
          summaries[i].plusSum += plus;
          summaries[i].minusSum += minus;

          // j側にも対称にペアを追加
          summaries[j].pairs.push({
            otherUserId: A.userId,
            otherUserName: A.userName,
            plusCount: plus,
            minusCount: minus,
            matchedTitles,
            unmatchedTitles,
            matchedIds,
            unmatchedIds,
          });
          summaries[j].plusSum += plus;
          summaries[j].minusSum += minus;
        }
      }

      setParticipantSummaries(summaries);

      // Firestoreへ各参加者の合計を保存
      summaries.forEach(async (s) => {
        try {
          await setDoc(doc(db, "rooms", String(roomId), "matchAnalysis", s.userId), {
            userId: s.userId,
            userName: s.userName,
            plusSum: s.plusSum,
            minusSum: s.minusSum,
            computedAt: serverTimestamp(),
          }, { merge: true });
        } catch (e) {
          console.error('Match result: Failed to write matchAnalysis', e);
        }
      });

      // Firestoreへペアごとの詳細を保存
      const pairPromises: Promise<void>[] = [];
      for (let i = 0; i < userSignMaps.length; i++) {
        for (let j = i + 1; j < userSignMaps.length; j++) {
          const A = userSignMaps[i];
          const B = userSignMaps[j];
          const pairData = summaries[i].pairs.find(p => p.otherUserId === B.userId);
          
          if (pairData) {
            const promise = (async () => {
              try {
                const pairDocId = [A.userId, B.userId].sort().join('_');
                await setDoc(doc(db, "rooms", String(roomId), "matchAnalysisPairs", pairDocId), {
                  userAId: A.userId,
                  userAName: A.userName,
                  userBId: B.userId,
                  userBName: B.userName,
                  plusCount: pairData.plusCount,
                  minusCount: pairData.minusCount,
                  computedAt: serverTimestamp(),
                }, { merge: true });
              } catch (e) {
                console.error('Match result: Failed to write matchAnalysisPairs', e);
              }
            })();
            pairPromises.push(promise);
          }
        }
      }
      
      await Promise.all(pairPromises);

      setAgreementReady(true);
      } catch (error) {
        console.error('Match result: Error in sum-based calculation:', error);
        setParticipantSummaries([]);
        setAgreementReady(true);
      }
    })();
  }, [userSelections]);

  // ========== Phase Transition Effects ==========

  // アナウンスからドラムロールへ
  useEffect(() => {
    if (phase === 'announce') {
      const t = setTimeout(() => {
        console.log('Match result: Setting phase to drumroll');
        setPhase('drumroll');
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // ドラムロール音声再生とリビールへの遷移
  useEffect(() => {
    if (phase === 'drumroll') {
      console.log('Match result: Starting drumroll phase');
      
      if (drumrollRef.current) {
        drumrollRef.current.currentTime = 0;
        drumrollRef.current.play().catch(e => 
          console.log('Match result: Could not play drumroll:', e)
        );
      }

      const t = setTimeout(() => {
        console.log('Match result: Setting phase to reveal');
        setPhase('reveal');
      }, 4000);
      
      return () => clearTimeout(t);
    }
  }, [phase]);

  // リビールフェーズでバン音再生（自動遷移は廃止）
  useEffect(() => {
    if (phase === 'reveal') {
      console.log('Match result: Starting reveal phase');
      
      if (banRef.current) {
        banRef.current.currentTime = 0;
        banRef.current.play().catch(e => 
          console.log('Match result: Could not play ban:', e)
        );
      }
      // 自動遷移なし
    }
  }, [phase, router, roomId]);

  // ========== Render ==========

  if (isLoading || !agreementReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-pink-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-6xl mb-4">🔄</div>
          <div className="text-2xl font-bold mb-2">合致度を集計中...</div>
          <div className="text-lg">参加者のデータを集計しています</div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #0b102d 40%, #18092c 100%)',
      }}
    >
      {/* Audio elements */}
      <audio ref={drumrollRef} preload="auto">
        <source src="/audio/drumroll.mp3" type="audio/mpeg" />
      </audio>
      <audio ref={banRef} preload="auto">
        <source src="/audio/ban.mp3" type="audio/mpeg" />
      </audio>



      {/* 背景の装飾グロー */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        <div style={{ position: 'absolute', top: -120, left: -120, width: '55vmax', height: '55vmax', borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.18), rgba(14,165,233,0.08), transparent 70%)', filter: 'blur(30px)' }} />
        <div style={{ position: 'absolute', bottom: -160, right: -160, width: '70vmax', height: '70vmax', borderRadius: '50%', background: 'radial-gradient(circle, rgba(251,191,36,0.18), rgba(236,72,153,0.10), transparent 70%)', filter: 'blur(35px)' }} />
      </div>

      <div style={{ color: '#fff', textAlign: 'center', position: 'relative', zIndex: 40, padding: '0 16px' }}>
        {phase === 'waiting' && (
          <div style={{ fontSize: '56px', marginBottom: '16px', animation: 'fadeInUp 0.8s ease-out both' }}>⏳</div>
        )}

        {phase === 'announce' && (
          <div style={{ animation: 'fadeInUp 0.8s ease-out both' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
            <div style={{
              fontSize: 'clamp(24px, 6vw, 40px)',
              fontWeight: 800,
              marginBottom: '12px',
              backgroundImage: 'linear-gradient(90deg, #fde68a, #fecaca, #c7d2fe)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: '0 2px 8px rgba(0,0,0,0.25)'
            }}>
              合致度の集計が完了！
            </div>
            <div style={{ fontSize: '18px', opacity: 0.9 }}>結果を発表します...</div>
          </div>
        )}

        {phase === 'drumroll' && (
          <div style={{ animation: 'fadeInUp 0.8s ease-out both' }}>
            <div style={{
              fontSize: 'clamp(22px, 5vw, 32px)',
              fontWeight: 700,
              letterSpacing: '0.02em',
              backgroundImage: 'linear-gradient(90deg, #c7d2fe, #f5d0fe, #fde68a)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent'
            }}>
              みんなの合致度は？
            </div>
          </div>
        )}

        {phase === 'reveal' && (
          <div style={{ animation: 'bounceIn 0.6s ease-out both', position: 'relative', margin: '0 auto', width: 'min(96vw, 980px)', padding: '0 8px' }}>
            <div style={{ position: 'relative', borderRadius: 28, border: '1px solid rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(22px)', boxShadow: '0 0 45px -10px rgba(255,255,255,0.5)', padding: '20px', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: participantSummaries.length === 2 ? '1fr 1fr' : '1fr 1fr', gridAutoRows: '1fr', gap: 16 }}>
                {participantSummaries.map((p, idx) => {
                  // 最大＋（気が合う）と最大−（気が合わない）を抽出
                  const bestPlus = p.pairs.reduce<null | typeof p.pairs[number]>((acc, cur) => {
                    if (!acc) return cur;
                    if (cur.plusCount > acc.plusCount) return cur;
                    if (cur.plusCount === acc.plusCount && cur.minusCount < acc.minusCount) return cur;
                    return acc;
                  }, null);
                  const worstMinus = p.pairs.reduce<null | typeof p.pairs[number]>((acc, cur) => {
                    if (!acc) return cur;
                    if (cur.minusCount > acc.minusCount) return cur;
                    if (cur.minusCount === acc.minusCount && cur.plusCount < acc.plusCount) return cur;
                    return acc;
                  }, null);

                  // 他の参加者番号を取得（自分以外）
                  const otherNumbers = participantSummaries
                    .map((_, i) => i + 1)
                    .filter(n => n !== idx + 1);

                  return (
                    <div key={p.userId} style={{ position: 'relative', border: '2px solid rgba(0,0,0,0.15)', borderRadius: 20, padding: '16px 14px', background: '#fff', minHeight: 200 }}>
                      {/* ヘッダー行：ユーザ名と他参加者番号 */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#1f2937' }}>{p.userName}</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {otherNumbers.map(n => {
                            const targetUser = participantSummaries[n - 1];
                            const pairData = p.pairs.find(pair => pair.otherUserId === targetUser?.userId);
                            return (
                              <div 
                                key={n} 
                                onClick={() => {
                                  if (pairData) {
                                    setDetailModal({ show: true, userA: p.userName, userB: targetUser.userName, pair: pairData });
                                  }
                                }}
                                style={{ 
                                  width: 24, 
                                  height: 24, 
                                  borderRadius: '50%', 
                                  border: '2px solid #9ca3af', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center', 
                                  fontSize: 12, 
                                  fontWeight: 700, 
                                  color: '#6b7280',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                                  e.currentTarget.style.borderColor = '#4b5563';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                  e.currentTarget.style.borderColor = '#9ca3af';
                                }}
                              >
                                {n}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 合致数（＋）ボックス */}
                      <div style={{ border: '2px solid #000', borderRadius: 16, padding: '10px 12px', background: '#fff', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#10b981' }}>合致数</div>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#10b981' }}>＋</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937' }}>：</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', flex: 1 }}>{bestPlus?.otherUserName ?? 'ユーザなし'}</div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: '#10b981' }}>＋{bestPlus?.plusCount ?? 0}</div>
                        </div>
                      </div>

                      {/* 合致数（－）ボックス */}
                      <div style={{ border: '2px solid #000', borderRadius: 16, padding: '10px 12px', background: '#fff' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: '#9333ea' }}>合致数</div>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #9333ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, color: '#9333ea' }}>－</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937' }}>：</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', flex: 1 }}>{worstMinus?.otherUserName ?? 'ユーザなし'}</div>
                          <div style={{ fontSize: 14, fontWeight: 900, color: '#9333ea' }}>－{worstMinus?.minusCount ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* カード詳細モーダル */}
              {detailModal.show && detailModal.pair && detailModal.userA && detailModal.userB && (
                <div 
                  style={{ 
                    position: 'fixed', 
                    inset: 0, 
                    backgroundColor: 'rgba(0,0,0,0.7)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    zIndex: 100,
                    padding: 16
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailModal({ show: false, userA: '', userB: '', pair: null });
                  }}
                >
                  <div 
                    style={{ 
                      background: '#fff', 
                      borderRadius: 20, 
                      padding: '20px', 
                      maxWidth: 800, 
                      width: '100%',
                      maxHeight: '80vh',
                      overflowY: 'auto'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* ヘッダー */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                      <div style={{ background: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)', padding: '12px 16px', borderRadius: 12, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#065f46' }}>{detailModal.userB}：＋</div>
                      </div>
                      <div style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', padding: '12px 16px', borderRadius: 12, textAlign: 'center' }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>{detailModal.userB}：－</div>
                      </div>
                    </div>

                    {/* カード一覧 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
                      {/* 合致カード（＋） */}
                      {detailModal.pair.matchedIds.map((cardId, index) => {
                        const card = cards.find(c => c.id === cardId);
                        if (!card) return null;
                        
                        // このカードに対する両ユーザーの選択を取得
                        const userASelection = userSelections.find(u => u.userName === detailModal.userA);
                        const userBSelection = userSelections.find(u => u.userName === detailModal.userB);
                        
                        const getCategoryLabel = (cats: any, id: string) => {
                          if (cats.veryWant?.some((x: any) => String(x.id) === String(id))) return '特に行きたい';
                          if (cats.want?.some((x: any) => String(x.id) === String(id))) return '行きたい';
                          if (cats.neutral?.some((x: any) => String(x.id) === String(id))) return 'どちらでもいい';
                          if (cats.dont?.some((x: any) => String(x.id) === String(id))) return '行きたくない';
                          if (cats.veryDont?.some((x: any) => String(x.id) === String(id))) return '特に行きたくない';
                          return '';
                        };
                        
                        const labelA = userASelection ? getCategoryLabel(userASelection.categories, String(cardId)) : '';
                        const labelB = userBSelection ? getCategoryLabel(userBSelection.categories, String(cardId)) : '';
                        
                        const getColor = (label: string) => {
                          if (label.includes('特に行きたい')) return { bg: '#fecaca', border: '#dc2626', text: '#7f1d1d' };
                          if (label.includes('行きたい')) return { bg: '#fbcfe8', border: '#db2777', text: '#831843' };
                          if (label.includes('どちらでもいい')) return { bg: '#e5e7eb', border: '#6b7280', text: '#1f2937' };
                          if (label.includes('行きたくない')) return { bg: '#bfdbfe', border: '#2563eb', text: '#1e3a8a' };
                          if (label.includes('特に行きたくない')) return { bg: '#99f6e4', border: '#0d9488', text: '#134e4a' };
                          return { bg: '#f3f4f6', border: '#9ca3af', text: '#4b5563' };
                        };
                        
                        return (
                          <div key={`matched-${cardId}-${index}`} style={{ border: '2px solid #10b981', borderRadius: 12, padding: 10, background: '#f0fdf4' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#065f46', marginBottom: 6 }}>{card.title}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {labelA && (() => {
                                const color = getColor(labelA);
                                return (
                                  <div style={{ background: color.bg, border: `1px solid ${color.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, color: color.text }}>1・{labelA}</div>
                                );
                              })()}
                              {labelB && (() => {
                                const color = getColor(labelB);
                                return (
                                  <div style={{ background: color.bg, border: `1px solid ${color.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, color: color.text }}>2・{labelB}</div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* 不一致カード（－） */}
                      {detailModal.pair.unmatchedIds.map((cardId, index) => {
                        const card = cards.find(c => c.id === cardId);
                        if (!card) return null;
                        
                        const userASelection = userSelections.find(u => u.userName === detailModal.userA);
                        const userBSelection = userSelections.find(u => u.userName === detailModal.userB);
                        
                        const getCategoryLabel = (cats: any, id: string) => {
                          if (cats.veryWant?.some((x: any) => String(x.id) === String(id))) return '特に行きたい';
                          if (cats.want?.some((x: any) => String(x.id) === String(id))) return '行きたい';
                          if (cats.neutral?.some((x: any) => String(x.id) === String(id))) return 'どちらでもいい';
                          if (cats.dont?.some((x: any) => String(x.id) === String(id))) return '行きたくない';
                          if (cats.veryDont?.some((x: any) => String(x.id) === String(id))) return '特に行きたくない';
                          return '';
                        };
                        
                        const labelA = userASelection ? getCategoryLabel(userASelection.categories, String(cardId)) : '';
                        const labelB = userBSelection ? getCategoryLabel(userBSelection.categories, String(cardId)) : '';
                        
                        const getColor = (label: string) => {
                          if (label.includes('特に行きたい')) return { bg: '#fecaca', border: '#dc2626', text: '#7f1d1d' };
                          if (label.includes('行きたい')) return { bg: '#fbcfe8', border: '#db2777', text: '#831843' };
                          if (label.includes('どちらでもいい')) return { bg: '#e5e7eb', border: '#6b7280', text: '#1f2937' };
                          if (label.includes('行きたくない')) return { bg: '#bfdbfe', border: '#2563eb', text: '#1e3a8a' };
                          if (label.includes('特に行きたくない')) return { bg: '#99f6e4', border: '#0d9488', text: '#134e4a' };
                          return { bg: '#f3f4f6', border: '#9ca3af', text: '#4b5563' };
                        };
                        
                        return (
                          <div key={`unmatched-${cardId}-${index}`} style={{ border: '2px solid #9333ea', borderRadius: 12, padding: 10, background: '#faf5ff' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b21a8', marginBottom: 6 }}>{card.title}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {labelA && (() => {
                                const color = getColor(labelA);
                                return (
                                  <div style={{ background: color.bg, border: `1px solid ${color.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, color: color.text }}>1・{labelA}</div>
                                );
                              })()}
                              {labelB && (() => {
                                const color = getColor(labelB);
                                return (
                                  <div style={{ background: color.bg, border: `1px solid ${color.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 10, fontWeight: 700, color: color.text }}>2・{labelB}</div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 閉じるボタン */}
                    <div style={{ marginTop: 20, textAlign: 'center' }}>
                      <button
                        onClick={() => setDetailModal({ show: false, userA: '', userB: '', pair: null })}
                        style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#6b7280', color: '#fff', fontWeight: 700, cursor: 'pointer' }}
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* 下部ボタン */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <button
                  onClick={() => router.push(`/room/${roomId}/play3`)}
                  style={{ padding: '12px 24px', borderRadius: 8, fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer', backgroundColor: '#10b981', color: '#fff' }}
                >
                  確認を終了して議論フェーズへ進む
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}