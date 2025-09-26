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
  where,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
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

export default function Play3Page() {
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

  // participants (isReady:true) を購読し最終選択データとして利用
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const q = query(
      collection(db, 'rooms', roomId, 'participants'),
      where('isReady', '==', true)
    );
    const unsub = onSnapshot(q, snap => {
      const selections: UserSelection[] = [];
      snap.docs.forEach(d => {
        const data: any = d.data();
        if (!data?.categories) return; // 不備スキップ
        const normalized = normalizeCategories({
          verywant: (data.categories.veryWant || []).map((c: any) => ({ id: c.id, reason: c.reason })),
          want: (data.categories.want || []).map((c: any) => ({ id: c.id })),
          neutral: (data.categories.neutral || []).map((c: any) => ({ id: c.id })),
          dont: (data.categories.dont || []).map((c: any) => ({ id: c.id })),
          verydont: (data.categories.veryDont || []).map((c: any) => ({ id: c.id, reason: c.reason })),
        });
        selections.push({
          user: data.userId || data.userName || d.id,
          userId: data.userId || d.id,
          userName: data.userName || data.userId || d.id,
          planName: data.planName || '',
          categories: {
            veryWant: normalized.verywant.map(c => ({ id: c.id, reason: c.reason })),
            want: normalized.want.map(c => ({ id: c.id })),
            neutral: normalized.neutral.map(c => ({ id: c.id })),
            dont: normalized.dont.map(c => ({ id: c.id })),
            veryDont: normalized.verydont.map(c => ({ id: c.id, reason: c.reason })),
          }
        });
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
    const ratingMatrix = convertSelectionsToMatrix(userSelections, 40);
    
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-900 flex items-center justify-center">
        <div className="text-white text-2xl animate-pulse">読み込み中...</div>
      </div>
    );
  }

  const noData = !isLoading && userSelections.length === 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-sky-50 to-fuchsia-50">
      <div className="container mx-auto px-4 py-10">
        {/* Header / Overall Agreement */}
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-wide bg-gradient-to-r from-sky-500 via-indigo-500 to-fuchsia-500 text-transparent bg-clip-text drop-shadow mb-8">
            議論フェーズ
          </h1>
          <div className="relative inline-block">
            <div className="absolute inset-0 blur-3xl bg-gradient-to-r from-sky-400/30 via-indigo-400/25 to-fuchsia-400/30 rounded-full animate-pulse" />
            <div className="relative inline-flex flex-col items-center justify-center rounded-full w-60 h-60 md:w-72 md:h-72 bg-white/95 backdrop-blur-xl border border-white/60 shadow-[0_8px_40px_-10px_rgba(30,58,138,0.15)]">
              <div className="text-[56px] md:text-[74px] font-extrabold bg-gradient-to-br from-indigo-700 via-sky-600 to-fuchsia-600 bg-clip-text text-transparent drop-shadow tracking-tight">
                {overallAgreement.toFixed(1)}%
              </div>
              <div className="text-lg md:text-2xl font-bold text-slate-700 tracking-wide">
                全体合致率
              </div>
              <div className="mt-2 text-xs md:text-sm text-slate-500 tracking-wide">
                参加者: {userSelections.length}人
              </div>
            </div>
          </div>
        </header>

        {noData && (
          <div className="text-center text-white/80 text-lg">
            まだ誰も準備完了していません。少し待ってから再度確認してください。
          </div>
        )}

        {/* Cards Grid */}
        {!noData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-7">
          {cardAgreements.map((card) => {
            const cardInfo = allCards.find(c => c.id === card.cardId);
            const nonNeutralUsers = getNonNeutralUsers(card.cardId);
            const canDiscuss = canDiscussCard(card.cardId);
            const discussedCard = discussionStatus[card.cardId];
            const waitingCount = discussedCard?.participants?.length || 0;
            
            return (
              <div key={card.cardId} className="group bg-white rounded-2xl p-4 border border-slate-200 hover:shadow-xl transition relative overflow-hidden shadow-md">
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition pointer-events-none bg-gradient-to-br from-indigo-50 via-transparent to-sky-50" />
                {/* Card Image */}
                <div className="relative mb-4">
                  <img
                    src={cardInfo?.src}
                    alt={card.title}
                    className="w-full rounded-xl shadow-md ring-1 ring-slate-200"
                    style={{ WebkitBackfaceVisibility: 'hidden', backfaceVisibility: 'hidden', transform: 'translateZ(0)' }}
                  />
                  <div className="absolute top-2 right-2">
                    <span className="inline-flex items-center justify-center text-xs font-bold text-white bg-gradient-to-br from-sky-500 via-indigo-500 to-fuchsia-600 px-2.5 py-1 rounded-full shadow">
                      合致 {card.agreement.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Card Title */}
                <h3 className="text-slate-800 font-bold text-lg mb-4 text-center tracking-wide">
                  {card.title}
                </h3>

                {/* User Selections */}
                <div className="space-y-2 mb-4 max-h-60 overflow-y-auto pr-1 custom-scroll">
                  {userSelections.map((user) => {
                    const selection = getUserSelectionForCard(card.cardId, user.userId);
                    if (!selection) return null;
                    
                    const categoryData = categoryInfo[selection.category as keyof typeof categoryInfo];
                    
                    return (
                      <div key={user.userId} className="text-xs md:text-sm bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-200">
                        <div className="flex flex-wrap items-center gap-1 md:gap-2">
                          <span className="text-slate-700 font-semibold truncate max-w-[90px]">{user.userName}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] md:text-[11px] font-medium tracking-wide shadow ${categoryData.color} ${categoryData.textColor}`}>
                            {categoryData.name}
                          </span>
                          {selection.reason && (
                            <span className="text-[10px] md:text-xs text-fuchsia-800 bg-fuchsia-100 px-2 py-0.5 rounded-full max-w-full truncate">
                              {selection.reason}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Discussion Button */}
                <div className="text-center mt-2">
                  <button
                    onClick={() => handleDiscussCard(card.cardId)}
                    disabled={nonNeutralUsers.length === 0 || !canDiscuss}
                    className={`w-full px-4 py-2 rounded-xl font-semibold text-sm tracking-wide transition-all shadow ${
                      nonNeutralUsers.length === 0
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : !canDiscuss
                          ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                          : 'bg-gradient-to-r from-sky-500 via-indigo-500 to-fuchsia-600 text-white hover:brightness-110 hover:shadow-md hover:scale-[1.01]'
                    }`}
                  >
                    {nonNeutralUsers.length === 0
                      ? '全員どちらでもいい'
                      : discussedCard?.isDiscussed
                        ? '議論済み'
                        : waitingCount > 0
                          ? `議論する (${waitingCount}/${nonNeutralUsers.length})`
                          : '議論する'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
