"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import styles from "./page.module.css";
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../../../../../lib/firebase";
import { agreementOverall, convertSelectionsToMatrix } from "../../../../../utils/agreement-calculator";

type UserSelection = {
  user: string;
  userId: string;
  userName: string;
  planName?: string;
  categories: {
    veryWant: Array<{id: string, reason?: string}>;
    want: Array<{id: string, reason?: string}>;
    neutral: Array<{id: string, reason?: string}>;
    dont: Array<{id: string, reason?: string}>;
    veryDont: Array<{id: string, reason?: string}>;
  };
};

type DiscussionDecision = {
  userId: string;
  userName: string;
  decision: 'go' | 'noGo' | 'pending';
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

export default function DiscussionPage() {
  const { roomId, cardId } = useParams();
  const router = useRouter();
  const { userName } = useUser();
  
  // ブラウザの戻るボタンを無効化
  usePreventBack();

  // State
  const [userSelections, setUserSelections] = useState<UserSelection[]>([]);
  const [discussionDecisions, setDiscussionDecisions] = useState<DiscussionDecision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overallAgreement, setOverallAgreement] = useState<number | null>(null);
  const [cardAgreement, setCardAgreement] = useState<number | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentUserDecision, setCurrentUserDecision] = useState<'go' | 'noGo' | 'pending' | null>(null);

  const card = allCards.find(c => c.id === cardId);

  // Load user selections from Firestore
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;

    const q = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const selections: UserSelection[] = [];
      
      snapshot.docs.forEach((doc) => {
        const data = doc.data();
        
        // Handle both old and new data formats
        if (data.categories) {
          selections.push({
            user: data.user || data.userId || data.userName,
            userId: data.userId || data.user || data.userName,
            userName: data.userName || data.user || data.userId,
            planName: data.planName || "",
            categories: data.categories,
          });
        } else {
          // Convert old format to new format
          const categories = {
            veryWant: [],
            want: (data.want || []).map((id: string) => ({ id })),
            neutral: [],
            dont: (data.dont || []).map((id: string) => ({ id })),
            veryDont: [],
          };
          
          selections.push({
            user: data.user,
            userId: data.user,
            userName: data.user,
            planName: data.planName || "",
            categories,
          });
        }
      });

      setUserSelections(selections);
      setParticipants(selections.map(s => s.userName || s.userId));
      setIsLoading(false);
      // 合致率計算
      try {
        if (selections.length >= 2) {
          const matrix = convertSelectionsToMatrix(selections);
          setOverallAgreement(agreementOverall(matrix));
        } else if (selections.length === 1) {
          setOverallAgreement(100);
        } else {
          setOverallAgreement(null);
        }
      } catch (e) {
        console.error('agreement calc error', e);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // Load discussion decisions
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string' || !cardId) return;

    const decisionsRef = doc(db, "rooms", roomId, "discussions", cardId as string);
    const unsubscribe = onSnapshot(decisionsRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setDiscussionDecisions(data.decisions || []);
        
        // Find current user's decision
        const userDecision = (data.decisions || []).find((d: DiscussionDecision) => d.userId === userName);
        setCurrentUserDecision(userDecision?.decision || null);
      }
    });

    return () => unsubscribe();
  }, [roomId, cardId, userName]);

  // Get user's selection for the card being discussed
  const getUserSelectionForCard = (userId: string) => {
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

  // Handle decision button click
  const handleDecision = async (decision: 'go' | 'noGo' | 'pending') => {
    if (!roomId || typeof roomId !== 'string' || !cardId || !userName) return;

    const decisionsRef = doc(db, "rooms", roomId, "discussions", cardId as string);
    
    // Get current decisions
    const docSnap = await getDoc(decisionsRef);
    const currentDecisions = docSnap.exists() ? docSnap.data().decisions || [] : [];
    
    // Update or add user's decision
    const updatedDecisions = currentDecisions.filter((d: DiscussionDecision) => d.userId !== userName);
    updatedDecisions.push({
      userId: userName,
      userName: userName,
      decision: decision,
    });

    await setDoc(decisionsRef, { decisions: updatedDecisions }, { merge: true });
    
    // Check if all users have made the same decision (excluding pending)
    const nonPendingDecisions = updatedDecisions.filter((d: DiscussionDecision) => d.decision !== 'pending');
    const allUsersCount = userSelections.length;
    
    if (nonPendingDecisions.length === allUsersCount) {
      const uniqueDecisions = [...new Set(nonPendingDecisions.map((d: DiscussionDecision) => d.decision))];
      
      if (uniqueDecisions.length === 1) {
        // All users made the same decision, update discussion status and return to play3
        const statusRef = doc(db, "rooms", roomId, "meta", "discussionStatus");
        const statusSnap = await getDoc(statusRef);
        const currentStatus = statusSnap.exists() ? statusSnap.data() : {};
        
        const newStatus = {
          ...currentStatus,
          [cardId as string]: {
            isDiscussed: true,
            participants: userSelections.map(u => u.userId),
            finalDecision: uniqueDecisions[0],
          }
        };
        
        await setDoc(statusRef, newStatus, { merge: true });
        
        // Return to play3
        router.push(`/room/${roomId}/play3`);
      }
    }
  };

  // Get decision counts
  const getDecisionCounts = () => {
    const goCount = discussionDecisions.filter(d => d.decision === 'go').length;
    const noGoCount = discussionDecisions.filter(d => d.decision === 'noGo').length;
    const pendingCount = discussionDecisions.filter(d => d.decision === 'pending').length;
    
    return { goCount, noGoCount, pendingCount };
  };

  const { goCount, noGoCount, pendingCount } = getDecisionCounts();

  // 対象カードの合致度（veryWant/ want を +1, dont/veryDont を -1, neutral 0 とし一致率）
  useEffect(() => {
    if (!cardId || userSelections.length === 0) {
      setCardAgreement(null);
      return;
    }
    const opinions: number[] = [];
    userSelections.forEach(u => {
      const cat = Object.entries(u.categories).find(([_, cards]) => cards.some(c => c.id === cardId));
      if (!cat) return;
      const key = cat[0];
      if (key === 'veryWant' || key === 'want') opinions.push(1);
      else if (key === 'veryDont' || key === 'dont') opinions.push(-1);
      else opinions.push(0);
    });
    if (opinions.length <= 1) {
      setCardAgreement(100);
      return;
    }
    // 全組み合わせ一致率
    let same = 0; let total = 0;
    for (let i=0;i<opinions.length;i++) {
      for (let j=i+1;j<opinions.length;j++) { total++; if (opinions[i] === opinions[j]) same++; }
    }
    setCardAgreement(total === 0 ? null : (same/total)*100);
  }, [cardId, userSelections]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">データを読み込み中...</div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-2xl">カードが見つかりません</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className="max-w-6xl mx-auto w-full px-4 py-6 space-y-10">
        {/* 合致率サマリー */}
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-2xl bg-white/90 shadow-md p-8 flex flex-col items-center text-center">
            <h2 className="text-2xl font-bold mb-4">みんなの合致率</h2>
            <div className="text-6xl font-extrabold bg-gradient-to-br from-sky-500 to-blue-600 bg-clip-text text-transparent tracking-tight mb-4">
              {overallAgreement !== null ? `${Math.round(overallAgreement)}%` : '—'}
            </div>
            <div className="text-lg mb-2">
              {overallAgreement !== null && (
                <span>
                  {overallAgreement >= 80 ? '👍 素晴らしい相性！' : overallAgreement >= 60 ? '👍 良い相性！' : '🌀 意見分散中'}
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500">参加者: {participants.join('・') || '—'}</div>
          </div>
          {/* カード別合致度 */}
          <div className="rounded-2xl bg-white/90 shadow-md p-6 flex flex-col">
            <h2 className="text-xl font-bold mb-4">カード別の合致度</h2>
            <div className="border rounded-xl p-4 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <img src={card?.src} alt={card?.title} className="w-20 h-20 object-cover rounded-md border" />
                <div>
                  <p className="font-semibold">{card?.title}</p>
                  <p className="text-green-600 font-bold text-lg">合致度: {cardAgreement !== null ? `${Math.round(cardAgreement)}%` : '—'}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {userSelections.map(u => {
                  const sel = getUserSelectionForCard(u.userId);
                  const label = sel?.category ? categoryInfo[sel.category as keyof typeof categoryInfo].name : '—';
                  return (
                    <div key={u.userId} className="border rounded-md p-2 text-center bg-white">
                      <div className="font-medium truncate" title={u.userName}>{u.userName}</div>
                      <div className="text-xs text-gray-600 mt-1">{label}</div>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => router.push(`/room/${roomId}/play3`)}
                className="mt-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-3 shadow active:scale-[0.98] transition"
              >結果を確認する</button>
            </div>
          </div>
        </div>
        <div className={styles.content}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.title}>
            議論中
          </h1>
          <h2 className={styles.subtitle}>
            {card.title}
          </h2>
        </div>

        {/* Main Content Grid */}
        <div className={styles.grid}>
          {/* Left Side - User 1 */}
          <div className="lg:col-span-1 flex flex-col justify-center">
            {userSelections[0] && (
              <UserCard 
                user={userSelections[0]} 
                selection={getUserSelectionForCard(userSelections[0].userId)}
                position="left"
              />
            )}
          </div>

          {/* Center - Card and Decisions */}
          <div className={styles.centerColumn}>
            {/* Card Display */}
            <div className={styles.cardContainer}>
              <div 
                className={`${styles.card} ${isFlipped ? styles.rotateY180 : ''}`}
                onClick={() => setIsFlipped(!isFlipped)}
              >
                <img
                  src={isFlipped ? card.backSrc : card.src}
                  alt={card.title}
                  className={styles.cardImage}
                />
              </div>
              <p className={styles.cardInstruction}>クリックで表裏を切り替え</p>
            </div>

            {/* Decision Buttons */}
            <div className={styles.buttonContainer}>
              <button
                onClick={() => handleDecision('go')}
                disabled={currentUserDecision === 'go' || currentUserDecision === 'noGo'}
                className={`${styles.button} ${styles.goButton} ${
                  currentUserDecision === 'go' ? styles.goButtonActive : ''
                } ${
                  currentUserDecision === 'noGo' ? styles.button + ' bg-gray-600 text-gray-400 cursor-not-allowed' : ''
                }`}
              >
                行く ({goCount}人)
              </button>
              
              <button
                onClick={() => handleDecision('noGo')}
                disabled={currentUserDecision === 'noGo' || currentUserDecision === 'go'}
                className={`${styles.button} ${styles.noGoButton} ${
                  currentUserDecision === 'noGo' ? styles.noGoButtonActive : ''
                } ${
                  currentUserDecision === 'go' ? styles.button + ' bg-gray-600 text-gray-400 cursor-not-allowed' : ''
                }`}
              >
                行かない ({noGoCount}人)
              </button>
              
              <button
                onClick={() => handleDecision('pending')}
                className={`${styles.button} ${styles.pendingButton} ${
                  currentUserDecision === 'pending' ? styles.pendingButtonActive : ''
                }`}
              >
                保留 ({pendingCount}人)
              </button>

              {/* Propose button (disabled) */}
              <button
                disabled
                className={`${styles.button} ${styles.proposeButton}`}
              >
                提案する（現在は使えません）
              </button>
            </div>
          </div>

          {/* Right Side - User 2 */}
          <div className="lg:col-span-1 flex flex-col justify-center">
            {userSelections[1] && (
              <UserCard 
                user={userSelections[1]} 
                selection={getUserSelectionForCard(userSelections[1].userId)}
                position="right"
              />
            )}
          </div>
        </div>

        {/* Bottom Users */}
        <div className={styles.bottomGrid}>
          {userSelections.slice(2).map((user) => (
            <UserCard 
              key={user.userId}
              user={user} 
              selection={getUserSelectionForCard(user.userId)}
              position="bottom"
            />
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

// User Card Component
function UserCard({ 
  user, 
  selection, 
  position 
}: { 
  user: UserSelection; 
  selection: {category: string, reason: string} | null;
  position: 'left' | 'right' | 'bottom';
}) {
  if (!selection) return null;
  
  const categoryData = categoryInfo[selection.category as keyof typeof categoryInfo];
  
  return (
    <div className={`${styles.userCard} ${position === 'bottom' ? styles.userCardCenter : ''}`}>
      <div className={styles.userHeader}>
        <h3 className={styles.userName}>{user.userName}</h3>
        <p className={styles.planName}>{user.planName || "プラン名未設定"}</p>
      </div>
      
      <div className="text-center">
        <span className={`${styles.categoryBadge} ${categoryData.color} ${categoryData.textColor}`}>
          {categoryData.name}
        </span>
      </div>
      
      {selection.reason && (
        <div className={styles.reasonContainer}>
          <p className={styles.reasonText}>
            <span className={styles.reasonLabel}>理由:</span> {selection.reason}
          </p>
        </div>
      )}
    </div>
  );
}
