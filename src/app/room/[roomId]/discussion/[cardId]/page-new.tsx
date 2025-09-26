"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@/context/UserContext";
import { usePreventBack } from "@/hooks/usePreventBack";
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { db } from "../../../../../../lib/firebase";

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
      setIsLoading(false);
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
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4">
            議論中
          </h1>
          <h2 className="text-2xl md:text-3xl text-gray-200 font-semibold">
            {card.title}
          </h2>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
          <div className="lg:col-span-1 flex flex-col items-center">
            {/* Card Display */}
            <div className="mb-8">
              <div 
                className="relative w-64 h-96 cursor-pointer transform hover:scale-105 transition-transform"
                onClick={() => setIsFlipped(!isFlipped)}
              >
                <div className={`absolute inset-0 transition-transform duration-500 ${isFlipped ? 'rotate-y-180' : ''}`}>
                  <img
                    src={isFlipped ? card.backSrc : card.src}
                    alt={card.title}
                    className="w-full h-full object-cover rounded-xl shadow-2xl"
                  />
                </div>
              </div>
              <p className="text-center text-white mt-4">クリックで表裏を切り替え</p>
            </div>

            {/* Decision Buttons */}
            <div className="space-y-4 w-full max-w-sm">
              <button
                onClick={() => handleDecision('go')}
                disabled={currentUserDecision === 'go' || currentUserDecision === 'noGo'}
                className={`w-full py-4 px-6 rounded-lg font-bold text-lg transition-all ${
                  currentUserDecision === 'go'
                    ? 'bg-green-600 text-white'
                    : currentUserDecision === 'noGo'
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-500 hover:bg-green-600 text-white transform hover:scale-105'
                }`}
              >
                行く ({goCount}人)
              </button>
              
              <button
                onClick={() => handleDecision('noGo')}
                disabled={currentUserDecision === 'noGo' || currentUserDecision === 'go'}
                className={`w-full py-4 px-6 rounded-lg font-bold text-lg transition-all ${
                  currentUserDecision === 'noGo'
                    ? 'bg-red-600 text-white'
                    : currentUserDecision === 'go'
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-red-500 hover:bg-red-600 text-white transform hover:scale-105'
                }`}
              >
                行かない ({noGoCount}人)
              </button>
              
              <button
                onClick={() => handleDecision('pending')}
                className={`w-full py-4 px-6 rounded-lg font-bold text-lg transition-all ${
                  currentUserDecision === 'pending'
                    ? 'bg-yellow-600 text-white'
                    : 'bg-yellow-500 hover:bg-yellow-600 text-white transform hover:scale-105'
                }`}
              >
                保留 ({pendingCount}人)
              </button>

              {/* Propose button (disabled) */}
              <button
                disabled
                className="w-full py-3 px-6 rounded-lg font-medium text-gray-400 bg-gray-600 cursor-not-allowed"
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
          {userSelections.slice(2).map((user, index) => (
            <UserCard 
              key={user.userId}
              user={user} 
              selection={getUserSelectionForCard(user.userId)}
              position="bottom"
            />
          ))}
        </div>
      </div>

      <style jsx>{`
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
      `}</style>
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
    <div className={`bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 ${
      position === 'bottom' ? 'text-center' : ''
    }`}>
      <div className="text-center mb-4">
        <h3 className="text-xl font-bold text-white mb-2">{user.userName}</h3>
        <p className="text-gray-300">{user.planName || "プラン名未設定"}</p>
      </div>
      
      <div className="text-center">
        <span className={`inline-block px-4 py-2 rounded-lg font-medium ${categoryData.color} ${categoryData.textColor}`}>
          {categoryData.name}
        </span>
      </div>
      
      {selection.reason && (
        <div className="mt-4 p-3 bg-white/5 rounded-lg">
          <p className="text-sm text-gray-300">
            <span className="font-medium">理由:</span> {selection.reason}
          </p>
        </div>
      )}
    </div>
  );
}
