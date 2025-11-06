"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  serverTimestamp,
  runTransaction,
  deleteField,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import {
  agreementForCard,
  agreementOverall,
  convertSelectionsToMatrix,
} from "../../../../utils/agreement-calculator";
import { normalizeCategories } from "../../../../utils/normalizeCategories";

type CategoryKey = "veryWant" | "want" | "neutral" | "dont" | "veryDont";

type UserSelection = {
  user: string;
  userId: string;
  userName: string;
  planName?: string;
  categories: Record<
    CategoryKey,
    Array<{
      id: string;
      reason?: string;
    }>
  >;
};

type CardVoteState = {
  go: string[];
  notGo: string[];
};

type Play3MetaState = {
  holds: string[];
  activeCardId: string | null;
};

const defaultMetaState: Play3MetaState = {
  holds: [],
  activeCardId: null,
};

type Play3SharedState = Play3MetaState;

const defaultSharedState: Play3SharedState = {
  ...defaultMetaState,
};

const ensureMetaState = (data: Partial<Play3MetaState> | undefined): Play3MetaState => ({
  holds: Array.isArray(data?.holds)
    ? (data?.holds.filter((id): id is string => typeof id === "string") ?? [])
    : [],
  activeCardId: typeof data?.activeCardId === "string" ? data?.activeCardId : null,
});

const ensureVoteState = (data: Partial<CardVoteState> | undefined): CardVoteState => ({
  go: Array.isArray(data?.go)
    ? (data?.go.filter((name): name is string => typeof name === "string") ?? [])
    : [],
  notGo: Array.isArray(data?.notGo)
    ? (data?.notGo.filter((name): name is string => typeof name === "string") ?? [])
    : [],
});

const allCards = Array.from({ length: 40 }, (_, i) => {
  const idx = i + 1;
  return {
    id: `card${idx}`,
    title: `カード${idx}`,
    src: `/pngs/USJ_${idx}_surface-1.png`,
    backSrc: `/pngs/back/USJ_${idx}_back-1.png`,
  };
});

const categoryLabel: Record<CategoryKey, string> = {
  veryWant: "特に行きたい",
  want: "行きたい",
  neutral: "どちらでもいい",
  dont: "行きたくない",
  veryDont: "特に行きたくない",
};

const categoryChipColor: Record<CategoryKey, { bg: string; text: string; border: string }> = {
  veryWant: { bg: "#fee2e2", text: "#7f1d1d", border: "#fecaca" },
  want: { bg: "#fecdd3", text: "#831843", border: "#fbcfe8" },
  neutral: { bg: "#e5e7eb", text: "#1f2937", border: "#cbd5f5" },
  dont: { bg: "#bfdbfe", text: "#0c4a6e", border: "#93c5fd" },
  veryDont: { bg: "#93c5fd", text: "#1e3a8a", border: "#60a5fa" },
};

const positiveCategories: CategoryKey[] = ["veryWant", "want"];
const negativeCategories: CategoryKey[] = ["dont", "veryDont"];

const areaPalette = {
  go: {
    background: "linear-gradient(135deg, #991b1b 0%, #dc2626 100%)",
    border: "#f87171",
    titleColor: "#fff",
  },
  notGo: {
    background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)",
    border: "#60a5fa",
    titleColor: "#f8fafc",
  },
  vs: {
    background: "linear-gradient(135deg, #f97316 0%, #fb923c 100%)",
    border: "#fb923c",
    titleColor: "#7c2d12",
  },
  neutral: {
    background: "linear-gradient(135deg, #9ca3af 0%, #d1d5db 100%)",
    border: "#d1d5db",
    titleColor: "#1f2937",
  },
};

const getCardInfo = (cardId: string) => allCards.find((card) => card.id === cardId);

const getInitial = (name: string) => {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
};

const formatCardNames = (ids: string[]) => {
  if (!ids.length) return "なし";
  return ids.map((id) => getCardInfo(id)?.title || id).join("、");
};

export default function Play3Page() {
  const { roomId } = useParams();
  const router = useRouter();
  const { userName } = useUser();

  usePreventBack();

  const [userSelections, setUserSelections] = useState<UserSelection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overallAgreement, setOverallAgreement] = useState(0);
  const [cardAgreements, setCardAgreements] = useState<
    { cardId: string; agreement: number; title: string }[]
  >([]);
  const [goDecidedIds, setGoDecidedIds] = useState<string[]>([]);
  const [notGoDecidedIds, setNotGoDecidedIds] = useState<string[]>([]);
  const [sharedState, setSharedState] = useState<Play3SharedState>(defaultSharedState);
  const [currentVotes, setCurrentVotes] = useState<CardVoteState>({ go: [], notGo: [] });
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(true);
  const [showNeutralArea, setShowNeutralArea] = useState(false);
  const [expandedDetail, setExpandedDetail] = useState(false);
  const [openParticipant, setOpenParticipant] = useState<string | null>(null);
  const [showBackSide, setShowBackSide] = useState(false);

  const participantCount = userSelections.length;

  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;

    const qSel = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsub = onSnapshot(qSel, (snap) => {
      const selections: UserSelection[] = [];
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.categories) {
          const normalized = normalizeCategories(data.categories);
          selections.push({
            user: data.user || data.userId || data.userName || d.id,
            userId: data.userId || data.user || data.userName || d.id,
            userName: data.userName || data.user || data.userId || d.id,
            planName: data.planName || data.planname || "",
            categories: {
              veryWant: (normalized.verywant || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              want: (normalized.want || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              neutral: (normalized.neutral || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              dont: (normalized.dont || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              veryDont: (normalized.verydont || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
            },
          });
        } else {
          const normalized = normalizeCategories({
            verywant: (data.verywant || []).map((id: string) => ({ id, reason: "" })),
            want: (data.want || []).map((id: string) => ({ id, reason: "" })),
            neutral: (data.neutral || []).map((id: string) => ({ id, reason: "" })),
            dont: (data.dont || []).map((id: string) => ({ id, reason: "" })),
            verydont: (data.verydont || []).map((id: string) => ({ id, reason: "" })),
          });
          selections.push({
            user: data.user || data.userId || d.id,
            userId: data.userId || data.user || d.id,
            userName: data.userName || data.user || d.id,
            planName: data.planName || data.planname || "",
            categories: {
              veryWant: (normalized.verywant || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              want: (normalized.want || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              neutral: (normalized.neutral || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              dont: (normalized.dont || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
              veryDont: (normalized.verydont || []).map((c: any) => ({ id: c.id, reason: c.reason || "" })),
            },
          });
        }
      });
      setUserSelections(selections);
      setIsLoading(false);
    });

    return () => unsub();
  }, [roomId]);

  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const q = query(collection(db, "rooms", roomId, "goNo"));
    const unsub = onSnapshot(q, (snap) => {
      const go: string[] = [];
      const no: string[] = [];
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.status === "go") go.push(d.id);
        if (data?.status === "no") no.push(d.id);
      });
      setGoDecidedIds(go);
      setNotGoDecidedIds(no);
    });
    return () => unsub();
  }, [roomId]);

  useEffect(() => {
    if (!stateRef) return;
    const unsub = onSnapshot(stateRef, (snap) => {
      if (!snap.exists()) {
        setSharedState((prev) => ({ ...prev, ...defaultMetaState }));
        return;
      }
      const raw = snap.data() as Record<string, unknown>;
      const meta = ensureMetaState(raw as Partial<Play3MetaState> | undefined);
      setSharedState((prev) => ({ ...prev, holds: meta.holds, activeCardId: meta.activeCardId }));
    });
    return () => unsub();
  }, [stateRef]);

  useEffect(() => {
    if (!votesCollectionRef || !selectedCardId) {
      setCurrentVotes({ go: [], notGo: [] });
      return;
    }
    const voteDocRef = doc(votesCollectionRef, selectedCardId);
    const unsub = onSnapshot(voteDocRef, (snap) => {
      if (!snap.exists()) {
        setCurrentVotes({ go: [], notGo: [] });
        return;
      }
      setCurrentVotes(
        ensureVoteState(snap.data() as Partial<CardVoteState> | undefined)
      );
    });
    return () => unsub();
  }, [votesCollectionRef, selectedCardId]);

  useEffect(() => {
    if (sharedState.activeCardId) {
      setSelectedCardId(sharedState.activeCardId);
    }
  }, [sharedState.activeCardId]);


  useEffect(() => {
    if (selectedCardId) {
      setShowBackSide(false);
      setExpandedDetail(participantCount <= 4);
    }
  }, [selectedCardId, participantCount]);
  useEffect(() => {
    if (userSelections.length === 0) return;
    const ratingMatrix = convertSelectionsToMatrix(userSelections, 40);
    const overall = agreementOverall(ratingMatrix);
    setOverallAgreement(overall);
    const cardResults = ratingMatrix.map((ratings, index) => ({
      cardId: `card${index + 1}`,
      title: `カード${index + 1}`,
      agreement: agreementForCard(ratings),
    }));
    setCardAgreements(cardResults);
  }, [userSelections]);

  const agreementMap = useMemo(() => {
    const map = new Map<string, number>();
    cardAgreements.forEach((c) => map.set(c.cardId, c.agreement));
    return map;
  }, [cardAgreements]);

  const participantOrder = useMemo(
    () =>
      userSelections.map((sel) => ({
        userName: sel.userName || sel.userId,
        planName: sel.planName || "未入力",
        categories: sel.categories,
      })),
    [userSelections]
  );

  const relevantCardIds = useMemo(() => {
    const ids = new Set<string>();
    userSelections.forEach((sel) => {
      (Object.values(sel.categories) as Array<{ id: string }>).forEach((cards) => {
        cards.forEach((card) => ids.add(card.id));
      });
    });
    goDecidedIds.forEach((id) => ids.add(id));
    notGoDecidedIds.forEach((id) => ids.add(id));
    return Array.from(ids);
  }, [userSelections, goDecidedIds, notGoDecidedIds]);

  const cardDetails = useMemo(() => {
    const detailMap = new Map<
      string,
      {
        userName: string;
        planName: string;
        category: CategoryKey;
        reason: string;
      }[]
    >();
    relevantCardIds.forEach((cardId) => {
      const perCard: {
        userName: string;
        planName: string;
        category: CategoryKey;
        reason: string;
      }[] = [];
      userSelections.forEach((sel) => {
        const user = sel.userName || sel.userId;
        const plan = sel.planName || "未入力";
        let found: { category: CategoryKey; reason: string } | null = null;
        (Object.entries(sel.categories) as [CategoryKey, { id: string; reason?: string }[]][]).some(
          ([category, cards]) => {
            const hit = cards.find((card) => card.id === cardId);
            if (hit) {
              found = { category, reason: hit.reason || "" };
              return true;
            }
            return false;
          }
        );
        perCard.push({
          userName: user,
          planName: plan,
          category: found ? found.category : "neutral",
          reason: found ? found.reason : "",
        });
      });
      detailMap.set(cardId, perCard);
    });
    return detailMap;
  }, [relevantCardIds, userSelections]);

  const sortByAgreement = (ids: string[]) => {
    return [...ids].sort((a, b) => {
      const agA = agreementMap.get(a) ?? -1;
      const agB = agreementMap.get(b) ?? -1;
      return agB - agA;
    });
  };

  const areaCards = useMemo(() => {
    const goSet = new Set(goDecidedIds);
    const noSet = new Set(notGoDecidedIds);
    const go: string[] = [];
    const notGo: string[] = [];
    const vs: string[] = [];
    const neutral: string[] = [];

    relevantCardIds.forEach((cardId) => {
      if (goSet.has(cardId)) {
        go.push(cardId);
        return;
      }
      if (noSet.has(cardId)) {
        notGo.push(cardId);
        return;
      }
      const responses = cardDetails.get(cardId) || [];
      if (!responses.length) {
        neutral.push(cardId);
        return;
      }
      const positiveCount = responses.filter((r) => positiveCategories.includes(r.category)).length;
      const negativeCount = responses.filter((r) => negativeCategories.includes(r.category)).length;
      const neutralCount = responses.filter((r) => r.category === "neutral").length;
      const hasNeutralReason = responses.some((r) => r.category === "neutral" && r.reason);

      if (participantCount > 0 && positiveCount === participantCount && positiveCount > 0) {
        go.push(cardId);
        return;
      }
      if (participantCount > 0 && negativeCount === participantCount && negativeCount > 0) {
        notGo.push(cardId);
        return;
      }
      if ((positiveCount > 0 && negativeCount > 0) || hasNeutralReason) {
        vs.push(cardId);
        return;
      }
      if (positiveCount > 0 && neutralCount > 0) {
        vs.push(cardId);
        return;
      }
      if (negativeCount > 0 && neutralCount > 0) {
        vs.push(cardId);
        return;
      }
      if (positiveCount === 0 && negativeCount === 0) {
        neutral.push(cardId);
        return;
      }
      vs.push(cardId);
    });

    return {
      go: sortByAgreement(go),
      notGo: sortByAgreement(notGo),
      vs: sortByAgreement(vs),
      neutral: sortByAgreement(neutral),
    };
  }, [goDecidedIds, notGoDecidedIds, relevantCardIds, cardDetails, participantCount]);

  const activeVotes = selectedCardId ? currentVotes : { go: [], notGo: [] };

  const stateRef = useMemo(() => {
    if (!roomId || typeof roomId !== "string") return null;
    return doc(db, "rooms", roomId, "meta", "play3State");
  }, [roomId]);

  const votesCollectionRef = useMemo(() => {
    if (!roomId || typeof roomId !== "string") return null;
    return collection(db, "rooms", roomId, "play3Votes");
  }, [roomId]);

  const uniqueName = userName?.trim() || "匿名";

  useEffect(() => {
    if (!stateRef) return;
    void (async () => {
      try {
        const snap = await getDoc(stateRef);
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        if (data && Object.prototype.hasOwnProperty.call(data, "votes")) {
          await setDoc(stateRef, { votes: deleteField() }, { merge: true });
        }
      } catch (error) {
        console.error("Failed to cleanup legacy votes field", error);
      }
    })();
  }, [stateRef]);

  const finalizeCard = async (cardId: string, status: "go" | "no") => {
    if (!roomId || typeof roomId !== "string") return;
    if (!stateRef || !votesCollectionRef) return;

    const voteDocRef = doc(votesCollectionRef, cardId);

    await runTransaction(db, async (transaction) => {
      const metaSnap = await transaction.get(stateRef);
      const metaState = ensureMetaState(
        metaSnap.exists() ? (metaSnap.data() as Partial<Play3MetaState>) : undefined
      );

      transaction.delete(voteDocRef);
      transaction.set(
        stateRef,
        {
          holds: metaState.holds.filter((id) => id !== cardId),
          activeCardId: null,
          votes: deleteField(),
        },
        { merge: true }
      );
    });

    await setDoc(
      doc(db, "rooms", roomId, "goNo", cardId),
      {
        status: status === "go" ? "go" : "no",
        decidedBy: uniqueName,
        decidedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setSelectedCardId(null);
    setCurrentVotes({ go: [], notGo: [] });
  };

  const handleVote = async (cardId: string, vote: "go" | "notGo") => {
    if (!stateRef || !votesCollectionRef) return;

    const voteDocRef = doc(votesCollectionRef, cardId);

    const result = await runTransaction(db, async (transaction) => {
      const metaSnap = await transaction.get(stateRef);
      const metaState = ensureMetaState(
        metaSnap.exists() ? (metaSnap.data() as Partial<Play3MetaState>) : undefined
      );

      const voteSnap = await transaction.get(voteDocRef);
      const existing = ensureVoteState(
        voteSnap.exists() ? (voteSnap.data() as Partial<CardVoteState>) : undefined
      );

      const sanitizedGo = existing.go.filter((n) => n !== uniqueName);
      const sanitizedNo = existing.notGo.filter((n) => n !== uniqueName);
      const updatedEntry: CardVoteState =
        vote === "go"
          ? { go: [...sanitizedGo, uniqueName], notGo: sanitizedNo }
          : { go: sanitizedGo, notGo: [...sanitizedNo, uniqueName] };

      transaction.set(voteDocRef, updatedEntry, { merge: false });
      transaction.set(
        stateRef,
        {
          holds: metaState.holds.filter((id) => id !== cardId),
          activeCardId: cardId,
          votes: deleteField(),
        },
        { merge: true }
      );

      return { updatedEntry };
    });

    setSelectedCardId(cardId);
    setCurrentVotes(result.updatedEntry);

    if (participantCount > 0) {
      if (result.updatedEntry.go.length === participantCount) {
        await finalizeCard(cardId, "go");
      } else if (result.updatedEntry.notGo.length === participantCount) {
        await finalizeCard(cardId, "no");
      }
    }
  };

  const handleHold = async (cardId: string) => {
    if (!stateRef) return;

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(stateRef);
      const current = ensureMetaState(
        snap.exists() ? (snap.data() as Partial<Play3MetaState>) : undefined
      );
      const alreadyHeld = current.holds.includes(cardId);
      const newHolds = alreadyHeld ? current.holds : [...current.holds, cardId];

      transaction.set(
        stateRef,
        {
          holds: newHolds,
          activeCardId: null,
          votes: deleteField(),
        },
        { merge: true }
      );
    });

    setSelectedCardId(null);
    setCurrentVotes({ go: [], notGo: [] });
  };

  const renderAvatar = (name: string, highlight?: boolean) => {
    return (
      <div
        key={name}
        onClick={() => setOpenParticipant((prev) => (prev === name ? null : name))}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: highlight ? "#22d3ee" : "#0f172a",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: highlight ? "0 0 0 3px rgba(34,211,238,0.4)" : "0 6px 16px rgba(15,23,42,0.35)",
        }}
        title={name}
      >
        {getInitial(name)}
      </div>
    );
  };

  const renderCard = (cardId: string) => {
    const info = getCardInfo(cardId);
    const agreement = agreementMap.get(cardId) ?? 0;
    const isHold = sharedState.holds.includes(cardId);
    return (
      <div
        key={cardId}
        onClick={() => {
          setSelectedCardId(cardId);
          setShowBackSide(false);
        }}
        style={{
          flex: "0 0 220px",
          maxWidth: 220,
          borderRadius: 16,
          overflow: "hidden",
          border: isHold ? "3px solid #fbbf24" : "1px solid rgba(148,163,184,0.4)",
          boxShadow: isHold
            ? "0 12px 30px rgba(250,204,21,0.35)"
            : "0 10px 24px rgba(15,23,42,0.25)",
          cursor: "pointer",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          transition: "transform .2s ease, box-shadow .2s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
        }}
      >
        <div style={{ height: 140, background: "#fff" }}>
          <img
            src={info?.src || "/placeholder-card.png"}
            alt={info?.title || cardId}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        </div>
        <div style={{ padding: "12px 14px", display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 16 }}>{info?.title || cardId}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>合致率 {agreement.toFixed(0)}%</div>
          {isHold && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: "#92400e",
                background: "rgba(251,191,36,0.18)",
                borderRadius: 999,
                padding: "3px 8px",
                textAlign: "center",
              }}
            >
              保留中
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderArea = (
    title: string,
    areaKey: keyof typeof areaPalette,
    cards: string[],
    extra?: React.ReactNode
  ) => {
    const palette = areaPalette[areaKey];
    return (
      <div
        style={{
          borderRadius: 24,
          padding: 20,
          background: palette.background,
          border: `3px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 220,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: palette.titleColor, fontWeight: 900, fontSize: 20 }}>{title}</div>
          <div style={{ color: palette.titleColor, fontWeight: 800, fontSize: 14 }}>{cards.length} 枚</div>
        </div>
        {extra}
        <div
          style={{
            display: "flex",
            gap: 16,
            overflowX: "auto",
            paddingBottom: 8,
          }}
        >
          {cards.map((cardId) => renderCard(cardId))}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #eff6ff 0%, #ede9fe 100%)",
          fontSize: 20,
          color: "#0f172a",
          fontWeight: 700,
        }}
      >
        読み込み中...
      </div>
    );
  }

  const noData = !isLoading && userSelections.length === 0;

  const selectedCardDetails = selectedCardId ? cardDetails.get(selectedCardId) || [] : [];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #f8fafc 0%, #e2e8f0 45%, #f1f5f9 100%)",
        paddingBottom: 80,
      }}
    >
      {showIntro && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.86)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
          }}
        >
          <div
            style={{
              maxWidth: 720,
              background: "linear-gradient(135deg, rgba(254,242,242,0.95) 0%, rgba(255,247,237,0.95) 100%)",
              padding: "48px 56px",
              borderRadius: 32,
              boxShadow: "0 40px 120px rgba(15,23,42,0.45)",
              textAlign: "center",
              color: "#7f1d1d",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 24 }}>
              全員の要望に沿ってカードを各エリアに当てはめました！
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#b45309" }}>
              VSのカードがなくなったらゲーム終了です！
            </div>
            <button
              onClick={() => setShowIntro(false)}
              style={{
                marginTop: 36,
                padding: "14px 32px",
                borderRadius: 999,
                border: "none",
                background: "linear-gradient(135deg,#dc2626,#fb923c)",
                color: "#fff",
                fontWeight: 900,
                fontSize: 18,
                cursor: "pointer",
                boxShadow: "0 16px 40px rgba(248,113,113,0.4)",
              }}
            >
              了解！
            </button>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px", position: "relative" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg,#0ea5e9,#6366f1)",
              color: "#fff",
              padding: "20px 28px",
              borderRadius: 28,
              boxShadow: "0 20px 60px rgba(14,165,233,0.35)",
              minWidth: 260,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, opacity: 0.9 }}>全体合致率</div>
            <div style={{ fontSize: 44, fontWeight: 900 }}>{overallAgreement.toFixed(0)}%</div>
          </div>

          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", gap: 16, position: "relative" }}>
            {participantOrder.map((p) => renderAvatar(p.userName, p.userName === uniqueName))}
            {openParticipant && (
              <div
                style={{
                  position: "absolute",
                  top: 60,
                  right: 0,
                  background: "#fff",
                  borderRadius: 20,
                  boxShadow: "0 24px 80px rgba(15,23,42,0.3)",
                  padding: 20,
                  width: 360,
                  zIndex: 20,
                }}
              >
                {(() => {
                  const target = participantOrder.find((p) => p.userName === openParticipant);
                  if (!target) return null;
                  return (
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>{target.userName}</div>
                      <div style={{ fontSize: 13, color: "#475569" }}>プラン名: <strong>{target.planName || "未入力"}</strong></div>
                      {(Object.entries(target.categories) as [CategoryKey, { id: string }[]][]).map(([category, cards]) => (
                        <div key={category} style={{ display: "grid", gap: 6 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#334155" }}>{categoryLabel[category]}</div>
                          <div style={{
                            fontSize: 12,
                            color: "#475569",
                            background: "#f8fafc",
                            borderRadius: 12,
                            padding: "8px 10px",
                            border: "1px solid #e2e8f0",
                          }}>
                            {formatCardNames(cards.map((c) => c.id))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {noData ? (
          <div
            style={{
              background: "rgba(255,255,255,0.9)",
              padding: 40,
              borderRadius: 24,
              textAlign: "center",
              fontWeight: 700,
              color: "#475569",
            }}
          >
            参加者のデータがまだありません。
          </div>
        ) : (
          <div style={{ display: "grid", gap: 32 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24 }}>
              {renderArea("行く", "go", areaCards.go)}
              {renderArea("行かない", "notGo", areaCards.notGo)}
            </div>

            {renderArea("VS（議論すべき目的地）", "vs", areaCards.vs, (
              <div style={{ color: "#7c2d12", fontWeight: 700, fontSize: 13 }}>
                行きたい派と行きたくない派、もしくは理由付きのどちらでもいいが混在しているカードです。
              </div>
            ))}

            <div>
              <button
                onClick={() => setShowNeutralArea((prev) => !prev)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 800,
                  color: "#1f2937",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  marginBottom: 12,
                }}
              >
                <span style={{ fontSize: 18 }}>{showNeutralArea ? "▽" : "△"}</span>
                どちらでもいいエリアを{showNeutralArea ? "閉じる" : "開く"}
              </button>
              {showNeutralArea && renderArea("どちらでもいい", "neutral", areaCards.neutral)}
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 24,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <button
          onClick={() => {
            if (!roomId || typeof roomId !== "string") return;
            router.push(`/room/${roomId}/result`);
          }}
          disabled={areaCards.vs.length > 0}
          style={{
            padding: "16px 32px",
            borderRadius: 999,
            border: "none",
            fontSize: 18,
            fontWeight: 900,
            background: areaCards.vs.length > 0
              ? "linear-gradient(135deg,#cbd5f5,#94a3b8)"
              : "linear-gradient(135deg,#10b981,#22d3ee)",
            color: "#fff",
            cursor: areaCards.vs.length > 0 ? "not-allowed" : "pointer",
            boxShadow: areaCards.vs.length > 0
              ? "0 12px 30px rgba(148,163,184,0.35)"
              : "0 20px 60px rgba(14,165,233,0.4)",
            opacity: areaCards.vs.length > 0 ? 0.6 : 1,
          }}
        >
          終了して結果を見る
        </button>
      </div>

      {selectedCardId && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "min(90vw, 880px)",
              background: "#fff",
              borderRadius: 28,
              boxShadow: "0 40px 120px rgba(15,23,42,0.45)",
              overflow: "hidden",
              display: "grid",
              gridTemplateColumns: "minmax(240px, 1fr) minmax(360px, 1.3fr)",
              gap: 0,
            }}
          >
            <div
              style={{
                background: "#0f172a",
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                color: "#fff",
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 18 }}>カード</div>
              <div
                style={{
                  borderRadius: 20,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "#fff",
                }}
              >
                <img
                  src={
                    showBackSide
                      ? getCardInfo(selectedCardId)?.backSrc || "/placeholder-card.png"
                      : getCardInfo(selectedCardId)?.src || "/placeholder-card.png"
                  }
                  alt={getCardInfo(selectedCardId)?.title || selectedCardId}
                  style={{ width: "100%", height: 280, objectFit: "contain" }}
                />
              </div>
              <button
                onClick={() => setShowBackSide((prev) => !prev)}
                style={{
                  padding: "10px 16px",
                  borderRadius: 999,
                  border: "none",
                  background: "rgba(248,250,252,0.12)",
                  color: "#e2e8f0",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {showBackSide ? "表面を見る" : "裏面を見る"}
              </button>
            </div>
            <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 900, fontSize: 22, color: "#0f172a" }}>
                  {getCardInfo(selectedCardId)?.title || selectedCardId}
                </div>
                <button
                  onClick={() => setExpandedDetail((prev) => !prev)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#64748b",
                    fontWeight: 700,
                  }}
                >
                  {expandedDetail ? "▽ 詳細を閉じる" : "△ 詳細を開く"}
                </button>
              </div>
              <div style={{ display: "grid", gap: 12, maxHeight: expandedDetail ? 320 : 220, overflowY: "auto" }}>
                {selectedCardDetails.map((detail, index) => {
                  const chip = categoryChipColor[detail.category];
                  return (
                    <div
                      key={`${detail.userName}-${index}`}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 18,
                        padding: 16,
                        display: "grid",
                        gap: 8,
                        background: "#f8fafc",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ fontWeight: 800, color: "#0f172a" }}>{detail.userName}</div>
                        <div
                          style={{
                            background: chip.bg,
                            color: chip.text,
                            border: `1px solid ${chip.border}`,
                            borderRadius: 999,
                            padding: "4px 10px",
                            fontSize: 12,
                            fontWeight: 900,
                          }}
                        >
                          {categoryLabel[detail.category]}
                        </div>
                      </div>
                      {expandedDetail && (
                        <>
                          <div style={{ fontSize: 12, color: "#475569" }}>
                            プラン名: <strong>{detail.planName || "未入力"}</strong>
                          </div>
                          <div style={{ fontSize: 12, color: detail.reason ? "#334155" : "#94a3b8" }}>
                            理由: {detail.reason || "（理由なし）"}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: "auto" }}>
                <button
                  onClick={() => handleVote(selectedCardId, "go")}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    borderRadius: 16,
                    border: "none",
                    background: "linear-gradient(135deg,#ef4444,#f97316)",
                    color: "#fff",
                    fontWeight: 900,
                    position: "relative",
                    cursor: "pointer",
                  }}
                >
                  行く
                  <div style={{ position: "absolute", top: 6, right: 10, display: "flex", gap: 4 }}>
                    {activeVotes.go.map((name) => (
                      <div
                        key={`go-${name}`}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.18)",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 900,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {getInitial(name)}
                      </div>
                    ))}
                  </div>
                </button>
                <button
                  onClick={() => handleVote(selectedCardId, "notGo")}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    borderRadius: 16,
                    border: "none",
                    background: "linear-gradient(135deg,#1e40af,#2563eb)",
                    color: "#fff",
                    fontWeight: 900,
                    position: "relative",
                    cursor: "pointer",
                  }}
                >
                  行かない
                  <div style={{ position: "absolute", top: 6, right: 10, display: "flex", gap: 4 }}>
                    {activeVotes.notGo.map((name) => (
                      <div
                        key={`no-${name}`}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.18)",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 900,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {getInitial(name)}
                      </div>
                    ))}
                  </div>
                </button>
                <button
                  onClick={() => handleHold(selectedCardId)}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    borderRadius: 16,
                    border: "1px solid #facc15",
                    background: "rgba(253,230,138,0.25)",
                    color: "#92400e",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  保留して閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
