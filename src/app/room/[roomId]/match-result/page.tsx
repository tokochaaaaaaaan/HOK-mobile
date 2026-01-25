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

  // 演出フェーズ: 集計(waiting) -> アナウンス(announce) -> ドラムロール(drumroll) -> リビール(reveal)
  type Phase = 'waiting' | 'announce' | 'drumroll' | 'reveal';
  const [phase, setPhase] = useState<Phase>('waiting');
  // 合致度集計完了フラグ
  const [agreementReady, setAgreementReady] = useState(false);

  // Data states
  const [userSelections, setUserSelections] = useState<UserSelection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [roomParticipantCount, setRoomParticipantCount] = useState<number>(0);
  const participantNameByIdRef = useRef<Map<string, string>>(new Map());
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

  // 詳細表示（参加者ごとの「vs全員」）: モーダル
  const [detailModal, setDetailModal] = useState<{ open: boolean; userId: string; userName: string }>({ open: false, userId: '', userName: '' });
  const [detailSelectedOtherUserId, setDetailSelectedOtherUserId] = useState<string>('');

  // タイマー用
  const [secondsLeft, setSecondsLeft] = useState<number>(60);
  const timerStartedRef = useRef<number | null>(null);

  // 計算→保存の順序を保証するためのバージョン
  const [calcVersion, setCalcVersion] = useState(0);
  const lastWrittenVersionRef = useRef<number>(-1);

  // ========== Data Subscription ==========
  // ルーム参加者数/表示名の購読（全員ready後に計算するため）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;

    const roomRef = doc(db, "rooms", roomId);
    const unsub = onSnapshot(roomRef, (snap) => {
      const data: any = snap.data();
      const parts = data?.participants || {};

      const nameMap = new Map<string, string>();
      Object.entries(parts).forEach(([id, v]: any) => {
        if (typeof v === 'string') nameMap.set(String(id), v);
        else if (v && typeof v === 'object' && typeof (v as any).name === 'string') nameMap.set(String(id), (v as any).name);
      });
      participantNameByIdRef.current = nameMap;

      const count = Object.keys(parts).length;
      setRoomParticipantCount(count);
    });

    return () => unsub();
  }, [roomId]);

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
            const resolvedUserId = String(data.userId || data.user || data.userName || doc.id);
            const resolvedUserName = participantNameByIdRef.current.get(resolvedUserId)
              || String(data.userName || data.user || data.userId || doc.id);
            list.push({
              user: String(data.user || data.userId || data.userName || doc.id),
              userId: resolvedUserId,
              userName: resolvedUserName,
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
            
            const resolvedUserId = String(data.userId || data.user || doc.id);
            const resolvedUserName = participantNameByIdRef.current.get(resolvedUserId)
              || String(data.userName || data.user || doc.id);
            list.push({
              user: String(data.user || data.userId || doc.id),
              userId: resolvedUserId,
              userName: resolvedUserName,
              planName: data.planName || data.planname || "",
              categories,
            });
          } else {
            // データ不足の場合は空のカテゴリで追加
            console.warn('Match result: No valid category data found for user:', doc.id);
            const resolvedUserId = String(data.userId || data.user || doc.id);
            const resolvedUserName = participantNameByIdRef.current.get(resolvedUserId)
              || String(data.userName || data.user || doc.id);
            list.push({
              user: String(data.user || data.userId || doc.id),
              userId: resolvedUserId,
              userName: resolvedUserName,
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

    // 参加者数が取得できている場合は「全員分揃ってから」計算する
    if (roomParticipantCount > 0 && userSelections.length < roomParticipantCount) {
      console.log('Match result: Waiting for all participants to be ready before calculation', {
        roomParticipantCount,
        readySelections: userSelections.length,
      });
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
      const toNum = (arr: any[] | undefined) => (arr ?? [])
        .map((x: any) => {
          if (x == null) return Number.NaN;
          if (typeof x === 'number') return x;
          if (typeof x === 'string') return Number(x);
          if (typeof x === 'object') {
            if ('id' in x) return Number((x as any).id);
            if ('cardId' in x) return Number((x as any).cardId);
          }
          return Number.NaN;
        })
        .filter((n: number) => Number.isFinite(n));

      const normalizeCardIdToNumber = (v: any): number => {
        if (v == null) return Number.NaN;
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          // waitingページ等の形式: "card1" -> 1
          const m = v.match(/^card(\d+)$/i);
          if (m) return Number(m[1]);
          return Number(v);
        }
        if (typeof v === 'object') {
          const id = (v as any).id ?? (v as any).cardId;
          return normalizeCardIdToNumber(id);
        }
        return Number.NaN;
      };

      const toCardNums = (arr: any[] | undefined) => (arr ?? [])
        .map(normalizeCardIdToNumber)
        .filter((n: number) => Number.isFinite(n));

      const userSignMaps = uniqueSelections.map(sel => {
        const signMap = new Map<number, number>();
        
        // 処理順序が重要：ニュートラルを最後に設定する（上書き防止）
        toCardNums(sel.categories.veryWant as any).forEach(id => signMap.set(id, +1));
        toCardNums(sel.categories.want as any).forEach(id => signMap.set(id, +1));
        toCardNums(sel.categories.dont as any).forEach(id => signMap.set(id, -1));
        toCardNums(sel.categories.veryDont as any).forEach(id => signMap.set(id, -1));
        toCardNums(sel.categories.neutral as any).forEach(id => {
          // ニュートラルは既に符号が設定されていない場合のみ設定（重複は避ける）
          if (!signMap.has(id)) {
            signMap.set(id, 0);
          }
        });
        
        console.log(`Match result: User ${sel.userName} signMap:`, {
          veryWant: toCardNums(sel.categories.veryWant as any),
          want: toCardNums(sel.categories.want as any),
          neutral: toCardNums(sel.categories.neutral as any),
          dont: toCardNums(sel.categories.dont as any),
          veryDont: toCardNums(sel.categories.veryDont as any),
          mapSize: signMap.size,
          mapContent: Array.from(signMap.entries()).slice(0, 10)
        });
        
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
          
          console.log(`Match result: Pair ${A.userName} vs ${B.userName}:`, {
            plus,
            minus,
            matchedTitles,
            unmatchedTitles
          });

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

      // まずは計算結果を確定（画面表示のためのstate更新）
      setParticipantSummaries(summaries);
      setCalcVersion(v => v + 1);
      setAgreementReady(true);
      } catch (error) {
        console.error('Match result: Error in sum-based calculation:', error);
        setParticipantSummaries([]);
        setAgreementReady(true);
      }
    })();
  }, [roomParticipantCount, userSelections]);

  // ========== Save Results (after calculation) ==========
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    if (!agreementReady) return;
    if (participantSummaries.length < 2) return;

    // 全員分揃っている場合のみ保存
    if (roomParticipantCount > 0 && participantSummaries.length < roomParticipantCount) return;

    // 同じ計算結果を二重送信しない
    if (lastWrittenVersionRef.current === calcVersion) return;
    lastWrittenVersionRef.current = calcVersion;

    (async () => {
      try {
        const summaries = participantSummaries;

        await Promise.all(
          summaries.map(async (s) => {
            const bestPlus = s.pairs.reduce<null | PairDetail>((acc, cur) => {
              if (!acc) return cur;
              if (cur.plusCount > acc.plusCount) return cur;
              if (cur.plusCount === acc.plusCount && cur.minusCount < acc.minusCount) return cur;
              return acc;
            }, null);

            const worstMinus = s.pairs.reduce<null | PairDetail>((acc, cur) => {
              if (!acc) return cur;
              if (cur.minusCount > acc.minusCount) return cur;
              if (cur.minusCount === acc.minusCount && cur.plusCount < acc.plusCount) return cur;
              return acc;
            }, null);

            await setDoc(
              doc(db, 'rooms', String(roomId), 'matchAnalysis', s.userId),
              {
                userId: s.userId,
                userName: s.userName,
                plusSum: s.plusSum,
                minusSum: s.minusSum,
                // 全ペア結果（他ユーザーごとの合致/不合致数）を送信
                pairCounts: s.pairs.map(p => ({
                  otherUserId: p.otherUserId,
                  otherUserName: p.otherUserName,
                  plusCount: p.plusCount,
                  minusCount: p.minusCount,
                })),
                // 表示用の最大/最小（UIは引き続き“最大のみ表示”）
                bestPlus: bestPlus
                  ? {
                      otherUserId: bestPlus.otherUserId,
                      otherUserName: bestPlus.otherUserName,
                      plusCount: bestPlus.plusCount,
                      minusCount: bestPlus.minusCount,
                    }
                  : null,
                worstMinus: worstMinus
                  ? {
                      otherUserId: worstMinus.otherUserId,
                      otherUserName: worstMinus.otherUserName,
                      plusCount: worstMinus.plusCount,
                      minusCount: worstMinus.minusCount,
                    }
                  : null,
                algorithm: 'sign-match-v2',
                computedAt: serverTimestamp(),
              },
              { merge: true }
            );
          })
        );

        const pairWrites: Promise<void>[] = [];
        for (const s of summaries) {
          for (const p of s.pairs) {
            const aId = String(s.userId);
            const bId = String(p.otherUserId);
            const [leftId, rightId] = [aId, bId].sort();

            // 同一ペアを二重に書かない（片側だけ採用）
            if (aId !== leftId) continue;

            const pairDocId = `${leftId}_${rightId}`;
            pairWrites.push(
              setDoc(
                doc(db, 'rooms', String(roomId), 'matchAnalysisPairs', pairDocId),
                {
                  userAId: leftId,
                  userAName: s.userName,
                  userBId: rightId,
                  userBName: p.otherUserName,
                  plusCount: p.plusCount,
                  minusCount: p.minusCount,
                  computedAt: serverTimestamp(),
                },
                { merge: true }
              )
            );
          }
        }

        await Promise.all(pairWrites);
      } catch (e) {
        console.error('Match result: Failed to persist analysis', e);
      }
    })();
  }, [agreementReady, calcVersion, participantSummaries, roomId, roomParticipantCount]);

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

      // reveal フェーズで タイマーを開始（1分間のカウントダウン）
      if (!timerStartedRef.current) {
        timerStartedRef.current = Date.now();
        setSecondsLeft(60);
      }
    }
  }, [phase, router, roomId]);

  // 1分経過で強制的に play3 へ遷移
  useEffect(() => {
    if (phase !== 'reveal') return;
    
    const interval = setInterval(() => {
      if (timerStartedRef.current) {
        const elapsed = Math.floor((Date.now() - timerStartedRef.current) / 1000);
        const remaining = Math.max(0, 60 - elapsed);
        setSecondsLeft(remaining);
        
        // 60秒経過で遷移
        if (remaining <= 0) {
          clearInterval(interval);
          console.log('Match result: 1 minute elapsed, transitioning to play3');
          router.push(`/room/${roomId}/play3`);
        }
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [phase, roomId, router]);

  // 詳細モーダルを開いたら、最初の比較対象（他参加者）を自動選択
  useEffect(() => {
    if (!detailModal.open) return;

    const pairsSorted = (
      participantSummaries.find(s => String(s.userId) === String(detailModal.userId))
        ?.pairs
        ?.slice()
        .sort((a, b) => (a.otherUserName || '').localeCompare(b.otherUserName || '', 'ja'))
    ) || [];

    const firstOtherId = pairsSorted[0]?.otherUserId;
    setDetailSelectedOtherUserId(firstOtherId ? String(firstOtherId) : '');
  }, [detailModal.open, detailModal.userId, participantSummaries]);

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
      {/* 背景の装飾グロー */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
        <div style={{ position: 'absolute', top: -120, left: -120, width: '55vmax', height: '55vmax', borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.18), rgba(14,165,233,0.08), transparent 70%)', filter: 'blur(30px)' }} />
        <div style={{ position: 'absolute', bottom: -160, right: -160, width: '70vmax', height: '70vmax', borderRadius: '50%', background: 'radial-gradient(circle, rgba(251,191,36,0.18), rgba(236,72,153,0.10), transparent 70%)', filter: 'blur(35px)' }} />
      </div>

      {/* 右上のタイマー表示（フルスクリーンの外側） */}
      {phase === 'reveal' && (
        <div style={{
          position: 'fixed',
          top: 20,
          right: 20,
          background: 'rgba(0, 0, 0, 0.6)',
          color: '#fff',
          padding: '12px 20px',
          borderRadius: 12,
          fontWeight: 900,
          fontSize: 18,
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          zIndex: 200
        }}>
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}秒後にplay3へ
        </div>
      )}

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

                  return (
                    <div key={p.userId} style={{ position: 'relative', border: '2px solid rgba(0,0,0,0.15)', borderRadius: 20, padding: '16px 14px', background: '#fff', minHeight: 200 }}>
                      {/* ヘッダー行：ユーザ名と他参加者番号 */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#1f2937' }}>{p.userName}</div>
                        <button
                          type="button"
                          onClick={() => setDetailModal({ open: true, userId: p.userId, userName: p.userName })}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 10,
                            border: '2px solid #111827',
                            background: '#fff',
                            color: '#111827',
                            fontSize: 12,
                            fontWeight: 900,
                            cursor: 'pointer',
                            lineHeight: 1,
                          }}
                        >
                          詳細
                        </button>
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

      {/* 詳細モーダル（新しいウィンドウとして表示・大きめ） */}
      {detailModal.open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 400,
            padding: 20,
          }}
          onClick={() => setDetailModal({ open: false, userId: '', userName: '' })}
        >
          <div
            style={{
              width: 'min(98vw, 1280px)',
              background: '#fff',
              borderRadius: 22,
              border: '2px solid #111827',
              padding: 24,
              maxHeight: '94vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#111827' }}>
                {detailModal.userName} と全員の比較
              </div>
              <button
                type="button"
                onClick={() => setDetailModal({ open: false, userId: '', userName: '' })}
                style={{
                  padding: '8px 12px',
                  borderRadius: 12,
                  border: '2px solid #111827',
                  background: '#fff',
                  color: '#111827',
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >
                閉じる
              </button>
            </div>

            {(() => {
              const pairsSorted = (
                participantSummaries.find(s => String(s.userId) === String(detailModal.userId))
                  ?.pairs
                  ?.slice()
                  .sort((a, b) => (a.otherUserName || '').localeCompare(b.otherUserName || '', 'ja'))
              ) || [];

              if (pairsSorted.length === 0) {
                return <div style={{ fontSize: 12, color: '#111827', lineHeight: 1.45, opacity: 0.9 }}>—</div>;
              }

              const selectedPair =
                pairsSorted.find(p => String(p.otherUserId) === String(detailSelectedOtherUserId)) || pairsSorted[0];

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* 他参加者と比較できるアイコン */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>比較する相手：</div>
                    {pairsSorted.map((pair) => {
                      const active = String(pair.otherUserId) === String(detailSelectedOtherUserId);
                      const label = (pair.otherUserName || '?').trim();
                      const initial = label ? label.slice(0, 1) : '?';
                      return (
                        <button
                          key={`pick-${detailModal.userId}-${pair.otherUserId}`}
                          type="button"
                          onClick={() => setDetailSelectedOtherUserId(String(pair.otherUserId))}
                          title={label}
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 999,
                            border: active ? '3px solid #111827' : '2px solid rgba(17,24,39,0.35)',
                            background: active ? '#111827' : '#fff',
                            color: active ? '#fff' : '#111827',
                            fontWeight: 900,
                            fontSize: 14,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            lineHeight: 1,
                          }}
                        >
                          {initial}
                        </button>
                      );
                    })}
                  </div>

                  {/* 選んだ相手の＋/−カード出力 */}
                  <div
                    style={{
                      border: '2px solid #111827',
                      borderRadius: 16,
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, fontSize: 14, fontWeight: 900, color: '#111827' }}>{selectedPair.otherUserName}</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: '#10b981' }}>＋{selectedPair.plusCount}</div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: '#9333ea' }}>－{selectedPair.minusCount}</div>
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>合致カード（＋）</div>
                    {selectedPair.matchedIds && selectedPair.matchedIds.length > 0 ? (
                      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                        <div style={{ display: 'flex', gap: 10, width: 'max-content' }}>
                          {selectedPair.matchedIds.map((id) => {
                            const c = cards.find(cc => cc.id === id);
                            if (!c) return null;
                            return (
                              <div
                                key={`plus-${detailModal.userId}-${selectedPair.otherUserId}-${id}`}
                                style={{
                                  width: 160,
                                  flex: '0 0 auto',
                                  border: '2px solid #111827',
                                  borderRadius: 12,
                                  overflow: 'hidden',
                                  background: '#fff',
                                }}
                              >
                                <img src={c.frontSrc} alt={c.title} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 900, color: '#111827', lineHeight: 1.2 }}>
                                  {c.title}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#111827', lineHeight: 1.45, opacity: 0.9 }}>—</div>
                    )}

                    <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>不一致カード（－）</div>
                    {selectedPair.unmatchedIds && selectedPair.unmatchedIds.length > 0 ? (
                      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
                        <div style={{ display: 'flex', gap: 10, width: 'max-content' }}>
                          {selectedPair.unmatchedIds.map((id) => {
                            const c = cards.find(cc => cc.id === id);
                            if (!c) return null;
                            return (
                              <div
                                key={`minus-${detailModal.userId}-${selectedPair.otherUserId}-${id}`}
                                style={{
                                  width: 160,
                                  flex: '0 0 auto',
                                  border: '2px solid #111827',
                                  borderRadius: 12,
                                  overflow: 'hidden',
                                  background: '#fff',
                                }}
                              >
                                <img src={c.frontSrc} alt={c.title} style={{ width: '100%', height: 'auto', display: 'block' }} />
                                <div style={{ padding: '8px 10px', fontSize: 12, fontWeight: 900, color: '#111827', lineHeight: 1.2 }}>
                                  {c.title}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#111827', lineHeight: 1.45, opacity: 0.9 }}>—</div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}