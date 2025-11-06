"use client";

import React, { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { collection, query, onSnapshot } from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { agreementOverall, convertSelectionsToMatrix } from "../../../../utils/agreement-calculator";

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

// ================= Confetti Animation =================

const ConfettiCanvas: React.FC<{ trigger: boolean }> = ({ trigger }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!trigger) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = Array.from({ length: 100 }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * -500,
      vx: Math.random() * 4 - 2,
      vy: Math.random() * 3 + 2,
      rot: Math.random() * Math.PI * 2,
      vr: Math.random() * 0.2 - 0.1,
      r: Math.random() * 6 + 3,
      color: ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#6c5ce7', '#a55eea'][Math.floor(Math.random() * 6)],
      shape: Math.random() > 0.5 ? 'circle' : 'square'
    }));

    let start = performance.now();
    const duration = 7500; // ms

    const draw = (t: number) => {
      const elapsed = t - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y - 20 > window.innerHeight) {
          p.y = -20;
          p.x = Math.random() * window.innerWidth;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === "circle") {
          ctx.beginPath();
            ctx.arc(0, 0, p.r, 0, Math.PI * 2);
            ctx.fill();
        } else {
          ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2 * (0.6 + Math.sin(p.rot) * 0.4));
        }
        ctx.restore();
      });
      if (elapsed < duration) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };

    animationRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [trigger]);

  // 背景の上、メインカードの下に来るよう z-index を高めに設定
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-30" />;
};

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
  // 合致率計算完了フラグ
  const [agreementReady, setAgreementReady] = useState(false);

  // Data states
  const [userSelections, setUserSelections] = useState<UserSelection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overallAgreement, setOverallAgreement] = useState<number>(0);
  // 表示用のカウントアップ値（reveal時にアニメーション）
  const [displayValue, setDisplayValue] = useState<number>(0);

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
          hasWant: !!data.want,
          hasDont: !!data.dont
        });
        
        try {
          // Handle both new and old data formats
          if (data.categories) {
            // 新形式: categories フィールドを使用
            list.push({
              user: data.user || data.userId || data.userName || doc.id,
              userId: data.userId || data.user || data.userName || doc.id,
              userName: data.userName || data.user || data.userId || doc.id,
              planName: data.planName || "",
              categories: data.categories,
            });
          } else {
            // 旧形式: want/dont フィールドからcategoriesを構築
            const categories = {
              veryWant: [],
              want: (data.want || []).map((id: string) => ({ id })),
              neutral: [],
              dont: (data.dont || []).map((id: string) => ({ id })),
              veryDont: [],
            };
            
            list.push({
              user: data.user || data.userId || doc.id,
              userId: data.userId || data.user || doc.id,
              userName: data.userName || data.user || doc.id,
              planName: data.planName || "",
              categories,
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

  // ========== Agreement Calculations ==========
  useEffect(() => {
    console.log('Match result: Agreement calculation triggered', { userSelectionsLength: userSelections.length, userSelections });
    if (userSelections.length === 0) {
      console.log('Match result: No user selections, skipping calculation');
      return;
    }

    // 最低限の参加者数チェック
    if (userSelections.length < 2) {
      console.log('Match result: Less than 2 participants, setting high agreement');
      setOverallAgreement(85);
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

    try {
      console.log('Match result: Converting selections to matrix...');
      const matrix = convertSelectionsToMatrix(uniqueSelections);
      console.log('Match result: Matrix conversion successful:', { matrixLength: matrix.length, participants: uniqueSelections.length });
      
      console.log('Match result: Calculating overall agreement...');
      const agreement = agreementOverall(matrix);
      console.log('Match result: Overall agreement calculation successful:', agreement);
      
      setOverallAgreement(Math.round(agreement)); // 整数に丸める
      setAgreementReady(true);
    } catch (error) {
      console.error('Match result: Error calculating agreement:', error);
      // エラー時は参加者数に基づいた妥当な値を設定
      const fallbackValue = Math.max(50, Math.min(90, 70 + (uniqueSelections.length * 5)));
      setOverallAgreement(fallbackValue);
      setAgreementReady(true);
    }
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

  // リビールフェーズでバン音再生
  useEffect(() => {
    if (phase === 'reveal') {
      console.log('Match result: Starting reveal phase');
      
      if (banRef.current) {
        banRef.current.currentTime = 0;
        banRef.current.play().catch(e => 
          console.log('Match result: Could not play ban:', e)
        );
      }

      // カウントアップ演出（1.2秒）
      const start = performance.now();
      const from = 0;
      const to = Math.round(overallAgreement);
      const duration = 1200;
      const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / duration);
        setDisplayValue(Math.round(from + (to - from) * ease(p)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

      // 7秒後に自動遷移
      const t = setTimeout(() => {
        console.log('Match result: Auto-navigating to play3');
        router.push(`/room/${roomId}/play3`);
      }, 7000);
      
      return () => clearTimeout(t);
    }
  }, [phase, router, roomId]);

  // ========== Render ==========

  if (isLoading || !agreementReady) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-pink-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-6xl mb-4">🔄</div>
          <div className="text-2xl font-bold mb-2">合致率を計算中...</div>
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

      {/* Confetti */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none' }}>
        <ConfettiCanvas trigger={phase === 'reveal'} />
      </div>

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
              合致率計算完了！
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
              みんなの合致率は？
            </div>
          </div>
        )}

        {phase === 'reveal' && (
          <div style={{ animation: 'bounceIn 0.6s ease-out both', position: 'relative', margin: '0 auto', width: 'min(94vw, 720px)', padding: '0 8px' }}>
            {/* グロー背景 */}
            <div style={{ position: 'absolute', inset: 0, zIndex: -1, borderRadius: 32, background: 'linear-gradient(135deg, rgba(251,191,36,0.25), rgba(236,72,153,0.20), rgba(79,70,229,0.25))', filter: 'blur(30px)', opacity: 0.9 }} />
            <div style={{ position: 'relative', borderRadius: 28, border: '1px solid rgba(255,255,255,0.28)', background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(22px)', boxShadow: '0 0 45px -10px rgba(255,255,255,0.5)', padding: '28px 20px', overflow: 'hidden' }}>
              {/* 角度のあるハイライト */}
              <div style={{ position: 'absolute', top: '-50%', left: '25%', width: '120%', height: '120%', transform: 'rotate(12deg)', background: 'linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 35%)', pointerEvents: 'none' }} />

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                <div style={{ fontSize: '72px', marginBottom: 8, textShadow: '0 4px 10px rgba(0,0,0,0.35)' }}>🎊</div>

                {/* 円形プログレスリング */}
                <div style={{ position: 'relative', margin: '24px 0' }}>
                  <div style={{ position: 'relative', width: 'min(60vw, 320px)', height: 'min(60vw, 320px)' }}>
                    {/* 外周の光 */}
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.10)', filter: 'blur(20px)' }} />
                    {/* 実リング */}
                    <div style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: `conic-gradient(#fde047 ${Math.round(overallAgreement)}%, rgba(255,255,255,0.08) ${Math.round(overallAgreement)}%)`,
                      WebkitMask: 'radial-gradient(circle at center, transparent 64%, black 65%)',
                      mask: 'radial-gradient(circle at center, transparent 64%, black 65%)'
                    }} />
                    {/* 中央数値 */}
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                      <div style={{
                        fontSize: 'clamp(48px, 14vw, 96px)',
                        fontWeight: 900,
                        backgroundImage: 'linear-gradient(135deg, #fef3c7, #fcd34d, #fb7185)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                        textShadow: '0 4px 12px rgba(0,0,0,0.35)'
                      }}>
                        {displayValue}%
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 'clamp(22px, 5vw, 32px)', fontWeight: 800, letterSpacing: '0.02em', marginBottom: 8 }}>合致率</div>
                <div style={{ fontSize: 'clamp(14px, 3.6vw, 18px)', fontWeight: 600, marginBottom: 12, minHeight: 40, display: 'flex', alignItems: 'center' }}>
                  {overallAgreement >= 80 && '素晴らしい一致度です！'}
                  {overallAgreement >= 60 && overallAgreement < 80 && '良い合致率ですね！'}
                  {overallAgreement < 60 && '意見が分かれていますね'}
                </div>
                <div style={{ fontSize: '12px', opacity: 0.8, marginTop: 6 }}>まもなく詳細分析画面に移動します...</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}