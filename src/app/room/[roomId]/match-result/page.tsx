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

  // z-index を低くしてテキストを前面に出せるように調整
  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />;
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
      
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        console.log('Match result: Processing finalSelections doc:', { 
          docId: doc.id, 
          data,
          hasCategories: !!data.categories,
          hasWant: !!data.want,
          hasDont: !!data.dont
        });
        
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
      });
      
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

    if (userSelections.length < 2) {
      console.log('Match result: Less than 2 participants, setting high agreement');
      setOverallAgreement(85);
      setAgreementReady(true);
      return;
    }

    try {
      console.log('Match result: Converting selections to matrix...');
      const matrix = convertSelectionsToMatrix(userSelections);
      console.log('Match result: Matrix conversion successful:', { matrixLength: matrix.length, matrix });
      
      console.log('Match result: Calculating overall agreement...');
      const agreement = agreementOverall(matrix);
      console.log('Match result: Overall agreement calculation successful:', agreement);
      
      setOverallAgreement(agreement);
      setAgreementReady(true);
    } catch (error) {
      console.error('Match result: Error calculating agreement:', error);
      // Fallback値を設定
      setOverallAgreement(75);
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
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-pink-900 flex items-center justify-center relative overflow-hidden">
      {/* Audio elements */}
      <audio ref={drumrollRef} preload="auto">
        <source src="/audio/drumroll.mp3" type="audio/mpeg" />
      </audio>
      <audio ref={banRef} preload="auto">
        <source src="/audio/ban.mp3" type="audio/mpeg" />
      </audio>

      {/* Confetti */}
      <ConfettiCanvas trigger={phase === 'reveal'} />

  <div className="text-center text-white z-10 relative">
        {phase === 'waiting' && (
          <div className="text-6xl mb-4 animate-pulse">⏳</div>
        )}

        {phase === 'announce' && (
          <div className="animate-fadeIn">
            <div className="text-6xl mb-6">🎉</div>
            <div className="text-4xl font-bold mb-4">合致率計算完了！</div>
            <div className="text-xl">結果を発表します...</div>
          </div>
        )}

        {phase === 'drumroll' && (
          <div className="animate-pulse">
            <div className="text-xl">みんなの合致率は？</div>
          </div>
        )}

        {phase === 'reveal' && (
          <div className="animate-bounceIn relative mx-auto w-[min(90vw,640px)] px-2">
            {/* グロー背景 */}
            <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-br from-yellow-400/30 via-pink-500/20 to-purple-600/30 blur-2xl opacity-80" />
            <div className="relative rounded-3xl border border-white/30 bg-white/10 backdrop-blur-xl shadow-[0_0_35px_-5px_rgba(255,255,255,0.4)] p-10">
              <div className="absolute inset-0 rounded-3xl pointer-events-none [mask-image:radial-gradient(circle_at_30%_20%,white,transparent)]" />
              <div className="flex flex-col items-center relative">
                <div className="text-7xl md:text-8xl mb-6 drop-shadow-lg">🎊</div>
                <div className="text-[11vw] md:text-7xl font-extrabold mb-4 text-transparent bg-clip-text bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-500 drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)] tracking-tight">
                  {Math.round(overallAgreement)}%
                </div>
                <div className="text-3xl md:text-4xl font-bold mb-3 tracking-wide">
                  合致率
                </div>
                <div className="text-lg md:text-xl font-medium mb-4 min-h-[2.5rem] flex items-center">
                  {overallAgreement >= 80 && "素晴らしい一致度です！"}
                  {overallAgreement >= 60 && overallAgreement < 80 && "良い合致率ですね！"}
                  {overallAgreement < 60 && "意見が分かれていますね"}
                </div>
                <div className="text-xs md:text-sm mt-6 opacity-70">
                  まもなく詳細分析画面に移動します...
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}