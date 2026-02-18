"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { activeCards } from "@/data/cards";
import { useUser } from "@/context/UserContext";
import MapButton from "@/components/MapButton";
import { addAuthKey } from "../../../../../lib/firebase-auth";
import { db } from "../../../../../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

type VoteChoice = "go" | "no" | "neutral";
type AssignmentStatus = "go" | "no" | "neutral" | "vs";

type UiStage = "board" | "discussion" | "afterVote" | "discussionEnd";

type Mobile3State = {
  phase?: "voting" | "finished";
  stage?: UiStage;
  sessionId?: string | null;
  expectedUserIds?: string[];
  cardId?: string | null;
  lastMove?: {
    cardId: string;
    title: string;
    status: AssignmentStatus;
    movedBy?: string;
  };
  updatedAt?: any;
};

const STATE_DOC = "mobile3State";

export default function Mobile3Page() {
  const params = useParams();
  const router = useRouter();
  const roomId = Array.isArray((params as any)?.roomId)
    ? (params as any).roomId[0]
    : ((params as any)?.roomId as string);
  const { userName } = useUser();
  const normalizedUserName = useMemo(() => (userName ? userName.trim() : ""), [userName]);

  usePreventBack();

  // 議論モーダルのレイアウトを端末幅に合わせる
  useEffect(() => {
    const onResize = () => setIsNarrowScreen(window.innerWidth < 520);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const cards = useMemo(
    () =>
      activeCards.map((c) => ({
        cardId: `card${c.id}`,
        title: c.title,
        frontSrc: c.frontSrc,
        backSrc: c.backSrc,
      })),
    []
  );

  const [participants, setParticipants] = useState<string[]>([]);
  const [state, setState] = useState<Mobile3State>({ phase: "voting", stage: "board", cardId: null, sessionId: null });
  const [votes, setVotes] = useState<Array<{ id: string; sessionId: string; cardId: string; userId: string; vote: VoteChoice }>>([]);
  const [assignments, setAssignments] = useState<Record<string, AssignmentStatus>>({});

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewIsBack, setPreviewIsBack] = useState(false);

  const [isCompactWindow, setIsCompactWindow] = useState(false);

  const [isNarrowScreen, setIsNarrowScreen] = useState(false);

  const [isBack, setIsBack] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [showSubmittedResults, setShowSubmittedResults] = useState(false);
  const [submittedSelections, setSubmittedSelections] = useState<
    Array<{
      userName: string;
      want: string[];
      neutral: string[];
      dont: string[];
      placementByCardId: Record<string, { area: "want" | "neutral" | "dont"; reason?: string }>;
    }>
  >([]);

  const [submittedActiveUser, setSubmittedActiveUser] = useState<string | null>(null);

  const [showVsWarning, setShowVsWarning] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1400);
  };

  // participants購読（rooms/{roomId}.participants の name一覧）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) {
        setParticipants([]);
        return;
      }
      const data: any = snap.data();
      const parts = data?.participants || {};
      const names = Object.values(parts)
        .map((v: any) => (typeof v === "string" ? v : v?.name))
        .map((v: any) => (typeof v === "string" ? v.trim() : ""))
        .filter((v: string) => v.length > 0);
      setParticipants(Array.from(new Set(names)));
    });
    return () => unsub();
  }, [roomId]);

  // mobile3State購読
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const ref = doc(db, "rooms", roomId, STATE_DOC, "state");
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const next = snap.data() as any;
      setState(next);
    });
    return () => unsub();
  }, [roomId]);

  // 初期化（stateが無い場合）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    (async () => {
      const ref = doc(db, "rooms", roomId, STATE_DOC, "state");
      const s = await getDoc(ref);
      const next = addAuthKey({
        phase: "voting",
        stage: "board" as UiStage,
        cardId: null,
        sessionId: null,
        expectedUserIds: [],
        updatedAt: serverTimestamp(),
      });
      if (!s.exists()) {
        await setDoc(ref, next, { merge: true });
        return;
      }

      const data: any = s.data();
      const hasValidPhase = data?.phase === "voting" || data?.phase === "finished";
      const hasValidCardId = data?.cardId == null || typeof data?.cardId === "string";
      const hasValidStage =
        data?.stage === "board" || data?.stage === "discussion" || data?.stage === "afterVote" || data?.stage === "discussionEnd";

      if (!hasValidPhase) {
        await setDoc(ref, next, { merge: true });
        return;
      }
      if (!hasValidCardId) {
        await setDoc(ref, addAuthKey({ cardId: null, updatedAt: serverTimestamp() }), { merge: true });
      }

      if (!hasValidStage) {
        const inferred: UiStage = data?.cardId ? "discussion" : "board";
        await setDoc(ref, addAuthKey({ stage: inferred, updatedAt: serverTimestamp() }), { merge: true });
      }
    })();
  }, [roomId]);

  // votes購読（rooms/{roomId}/mobile3Votes 全件 → ローカルでフィルタ）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const q = query(collection(db, "rooms", roomId, "mobile3Votes"));
    const unsub = onSnapshot(q, (snap) => {
      const list: Array<{ id: string; sessionId: string; cardId: string; userId: string; vote: VoteChoice }> = [];
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (!data?.sessionId || !data?.cardId || !data?.userId || !data?.vote) return;
        list.push({
          id: d.id,
          sessionId: String(data.sessionId),
          cardId: String(data.cardId),
          userId: String(data.userId),
          vote: String(data.vote) as VoteChoice,
        });
      });
      setVotes(list);
    });
    return () => unsub();
  }, [roomId]);

  // play3Assignments購読（エリアごとのカード配置表示用）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qAssign = query(collection(db, "rooms", roomId, "play3Assignments"));
    const unsub = onSnapshot(qAssign, (snap) => {
      const map: Record<string, AssignmentStatus> = {};
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const status = String(data?.status || "").trim();
        if (status === "go" || status === "no" || status === "neutral" || status === "vs") {
          map[d.id] = status;
        }
      });
      setAssignments(map);
    });
    return () => unsub();
  }, [roomId]);

  // mobile2提出結果（finalSelections）購読：mobile3から閲覧できるように
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qSel = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsub = onSnapshot(qSel, (snap) => {
      const list: Array<{
        userName: string;
        want: string[];
        neutral: string[];
        dont: string[];
        placementByCardId: Record<string, { area: "want" | "neutral" | "dont"; reason?: string }>;
      }> = [];

      const toItems = (arr: any): Array<{ id: string; reason?: string }> => {
        if (!Array.isArray(arr)) return [];
        return arr
          .map((v) => {
            if (!v) return null;
            if (typeof v === "string") return { id: v };
            if (typeof v === "object" && typeof (v as any).id === "string") {
              const r = typeof (v as any).reason === "string" ? (v as any).reason : undefined;
              return { id: (v as any).id, reason: r };
            }
            return null;
          })
          .filter(Boolean) as Array<{ id: string; reason?: string }>;
      };

      snap.docs.forEach((d) => {
        const data: any = d.data();
        const name = String(data?.userName || data?.userId || data?.user || d.id || "").trim();
        const raw = data?.categories || {};

        const wantItems = [...toItems(raw.want), ...toItems(raw.veryWant)];
        const neutralItems = toItems(raw.neutral);
        const dontItems = [...toItems(raw.dont), ...toItems(raw.veryDont)];

        const want = wantItems.map((i) => String(i.id).trim()).filter(Boolean);
        const neutral = neutralItems.map((i) => String(i.id).trim()).filter(Boolean);
        const dont = dontItems.map((i) => String(i.id).trim()).filter(Boolean);

        if (!name) return;

        const placementByCardId: Record<string, { area: "want" | "neutral" | "dont"; reason?: string }> = {};
        wantItems.forEach((it) => {
          const cid = String(it.id || "").trim();
          if (!cid) return;
          const reason = typeof it.reason === "string" ? it.reason.trim() : "";
          placementByCardId[cid] = { area: "want", reason: reason || undefined };
        });
        neutralItems.forEach((it) => {
          const cid = String(it.id || "").trim();
          if (!cid) return;
          const reason = typeof it.reason === "string" ? it.reason.trim() : "";
          placementByCardId[cid] = { area: "neutral", reason: reason || undefined };
        });
        dontItems.forEach((it) => {
          const cid = String(it.id || "").trim();
          if (!cid) return;
          const reason = typeof it.reason === "string" ? it.reason.trim() : "";
          placementByCardId[cid] = { area: "dont", reason: reason || undefined };
        });

        list.push({ userName: name, want, neutral, dont, placementByCardId });
      });

      // 参加者順を優先
      if (participants.length > 0) {
        const by = new Map(list.map((v) => [v.userName, v] as const));
        const ordered: typeof list = [];
        participants.forEach((p) => {
          const hit = by.get(p);
          if (hit) ordered.push(hit);
        });
        // participants以外がいたら後ろに付ける
        list.forEach((v) => {
          if (!ordered.some((o) => o.userName === v.userName)) ordered.push(v);
        });
        setSubmittedSelections(ordered);
      } else {
        setSubmittedSelections(list);
      }
    });
    return () => unsub();
  }, [roomId, participants]);

  // mobile2結果から自動分類（行きたい/行きたくない/どちらでもいい を比較）
  const autoAssignments = useMemo(() => {
    const map: Record<string, AssignmentStatus> = {};

    const wantCount: Record<string, number> = {};
    const dontCount: Record<string, number> = {};
    const neutralCount: Record<string, number> = {};

    const inc = (bucket: Record<string, number>, cardId: string) => {
      bucket[cardId] = (bucket[cardId] || 0) + 1;
    };

    submittedSelections.forEach((u) => {
      (u.want || []).forEach((cid) => inc(wantCount, cid));
      (u.dont || []).forEach((cid) => inc(dontCount, cid));
      (u.neutral || []).forEach((cid) => inc(neutralCount, cid));
    });

    cards.forEach((c) => {
      const w = wantCount[c.cardId] || 0;
      const d = dontCount[c.cardId] || 0;
      // 要望ロジック
      // - want>=1 && dont>=1 => VS
      // - else want>=1 => go
      // - else dont>=1 => no
      // - else => neutral
      if (w >= 1 && d >= 1) map[c.cardId] = "vs";
      else if (w >= 1) map[c.cardId] = "go";
      else if (d >= 1) map[c.cardId] = "no";
      else map[c.cardId] = "neutral";
    });

    return map;
  }, [submittedSelections, cards]);

  // play3Assignments が未作成（または不足）なら、mobile2結果で自動シードする
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    // 提出結果が無い場合は勝手に確定配置しない（表示だけはneutral扱い）
    if (submittedSelections.length === 0) return;

    const missing = cards
      .map((c) => c.cardId)
      .filter((cid) => !(assignments[cid] === "go" || assignments[cid] === "no" || assignments[cid] === "neutral" || assignments[cid] === "vs"));
    if (missing.length === 0) return;

    (async () => {
      for (const cid of missing) {
        const st = autoAssignments[cid] || "neutral";
        await setDoc(
          doc(db, "rooms", roomId, "play3Assignments", cid),
          addAuthKey({
            status: st,
            decidedBy: "autoMobile2",
            seededAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          { merge: true }
        );
      }
    })().catch(() => {});
  }, [roomId, submittedSelections.length, cards, assignments, autoAssignments]);

  const phase: "voting" | "finished" = state.phase === "finished" ? "finished" : "voting";
  const stage: UiStage =
    state.stage === "discussion" || state.stage === "afterVote" || state.stage === "discussionEnd" ? state.stage : "board";

  const currentCard = useMemo(() => {
    const cid = typeof state.cardId === "string" ? state.cardId : null;
    if (!cid) return null;
    return cards.find((c) => c.cardId === cid) ?? null;
  }, [state.cardId, cards]);

  const previewCard = useMemo(() => {
    if (!previewCardId) return null;
    return cards.find((c) => c.cardId === previewCardId) ?? null;
  }, [previewCardId, cards]);

  const expectedUserIds = useMemo(() => {
    const ids = Array.isArray(state.expectedUserIds) ? state.expectedUserIds : [];
    const cleaned = ids.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
    // 1人プレイやparticipants未整備でも、自分が必ず投票対象に入るようにする
    if (cleaned.length === 0 && normalizedUserName) return [normalizedUserName];
    if (normalizedUserName && !cleaned.includes(normalizedUserName)) return [...cleaned, normalizedUserName];
    return cleaned;
  }, [state.expectedUserIds]);
  const expectedCount = expectedUserIds.length > 0 ? expectedUserIds.length : participants.length;

  const votesForCurrent = useMemo(() => {
    if (!currentCard) return new Map<string, VoteChoice>();
    const sessionId = typeof state.sessionId === "string" ? state.sessionId : "";
    if (!sessionId) return new Map<string, VoteChoice>();
    const map = new Map<string, VoteChoice>();
    votes
      .filter((v) => v.sessionId === sessionId && v.cardId === currentCard.cardId)
      .forEach((v) => {
        map.set(v.userId, v.vote);
      });
    return map;
  }, [votes, currentCard, state.sessionId]);

  const voteAvatarBaseStyle = {
    width: 22,
    height: 22,
    borderRadius: "9999px",
    border: "1px solid rgba(15,23,42,0.14)",
    background: "#fff",
    boxShadow: "0 1px 4px rgba(15,23,42,0.12)",
    fontWeight: 900,
    fontSize: 11,
    color: "#0f172a",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;

  const renderVoteAvatars = (target: VoteChoice) => {
    const ordered = (participants.length > 0 ? participants : Array.from(votesForCurrent.keys()))
      .map((n) => (typeof n === "string" ? n.trim() : ""))
      .filter(Boolean);

    const voters = ordered.filter((id) => votesForCurrent.get(id) === target);
    if (voters.length === 0) return null;

    const maxIcons = Math.min(ordered.length, 4);
    const show = voters.slice(0, maxIcons);
    const rest = voters.length - show.length;

    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 6 }}>
        {show.map((id, idx) => (
          <div key={`${target}-${id}`} style={{ ...voteAvatarBaseStyle, marginLeft: idx ? -8 : 0 }} title={id}>
            {id?.[0]?.toUpperCase() || "?"}
          </div>
        ))}
        {rest > 0 && (
          <div key={`${target}-more`} style={{ ...voteAvatarBaseStyle, marginLeft: -8, fontSize: 10 }} title={`+${rest}`}>
            +{rest}
          </div>
        )}
      </div>
    );
  };

  const myVote = currentCard && normalizedUserName ? votesForCurrent.get(normalizedUserName) ?? null : null;

  const votedCount = useMemo(() => {
    if (!currentCard) return 0;
    const ordered = expectedUserIds.length > 0 ? expectedUserIds : participants;
    if (ordered.length === 0) return votesForCurrent.size;
    return ordered.reduce((acc, name) => acc + (votesForCurrent.has(name) ? 1 : 0), 0);
  }, [participants, votesForCurrent, currentCard]);

  const canFinish = useMemo(() => {
    if (cards.length === 0) return false;
    return cards.every((c) => {
      const st = assignments[c.cardId];
      return st === "go" || st === "no" || st === "neutral";
    });
  }, [cards, assignments]);

  const computeFinalStatus = (map: Map<string, VoteChoice>): AssignmentStatus => {
    const values = Array.from(map.values());
    const hasGo = values.includes("go");
    const hasNo = values.includes("no");
    const allNeutral = values.length > 0 && values.every((v) => v === "neutral");

    // play3の思想に寄せる：行くと行かないが混在したらコンフリクト（VS）
    if (hasGo && hasNo) return "vs";
    if (hasNo) return "no";
    if (hasGo) return "go";
    if (allNeutral) return "neutral";
    return "neutral";
  };

  const statusLabel = (st: AssignmentStatus) => {
    if (st === "go") return "行く";
    if (st === "no") return "行かない";
    if (st === "neutral") return "保留";
    return "議論中（VS）";
  };

  const finalizeCurrentIfReady = async () => {
    if (!roomId || typeof roomId !== "string") return;
    if (!currentCard) return;
    if (expectedCount < 1) return;
    if (votedCount !== expectedCount) return;
    if (stage !== "discussion") return;
    if (!state.sessionId) return;

    const finalStatus = computeFinalStatus(votesForCurrent);

    await runTransaction(db, async (tx) => {
      // assignments更新
      tx.set(
        doc(db, "rooms", roomId, "play3Assignments", currentCard.cardId),
        addAuthKey({
          status: finalStatus,
          decidedBy: "mobile3",
          decidedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );

      // 投票セッション終了 → afterVoteへ
      tx.set(
        doc(db, "rooms", roomId, STATE_DOC, "state"),
        addAuthKey({
          stage: "afterVote" as UiStage,
          cardId: null,
          sessionId: null,
          expectedUserIds: [],
          lastMove: {
            cardId: currentCard.cardId,
            title: currentCard.title,
            status: finalStatus,
            movedBy: userName || undefined,
          },
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      );
    });

    showToast(`「${currentCard.title}」→ ${statusLabel(finalStatus)}`);
    setIsBack(false);
  };

  // 全員投票済みなら自動確定
  useEffect(() => {
    if (phase !== "voting") return;
    if (!currentCard) return;
    if (expectedCount < 1) return;
    if (votedCount !== expectedCount) return;
    if (stage !== "discussion") return;
    finalizeCurrentIfReady().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentCard?.cardId, votedCount, expectedCount]);

  const startDiscussion = async (cardId: string) => {
    if (!roomId || typeof roomId !== "string") return;
    if (phase !== "voting") return;
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const expected = (participants.length > 0 ? participants : normalizedUserName ? [normalizedUserName] : [])
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);

    const expectedWithSelf =
      normalizedUserName && expected.length > 0
        ? expected.includes(normalizedUserName)
          ? expected
          : [...expected, normalizedUserName]
        : normalizedUserName
          ? [normalizedUserName]
          : expected;
    await setDoc(
      doc(db, "rooms", roomId, STATE_DOC, "state"),
      addAuthKey({
        stage: "discussion" as UiStage,
        cardId,
        sessionId,
        expectedUserIds: expectedWithSelf,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
    setIsBack(false);
    setIsCompactWindow(false);
  };

  const castVote = async (vote: VoteChoice) => {
    if (!roomId || typeof roomId !== "string") return;
    if (!currentCard) return;
    if (!normalizedUserName) return;
    const sessionId = typeof state.sessionId === "string" ? state.sessionId : "";
    if (!sessionId) return;

    await setDoc(
      doc(db, "rooms", roomId, "mobile3Votes", `${sessionId}__${currentCard.cardId}__${normalizedUserName}`),
      addAuthKey({
        sessionId,
        cardId: currentCard.cardId,
        userId: normalizedUserName,
        userName: normalizedUserName,
        vote,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );

    showToast("投票しました");
  };

  const orderedParticipants = (expectedUserIds.length > 0
    ? expectedUserIds
    : participants.length > 0
      ? participants
      : Array.from(new Set(votes.map((v) => v.userId)))
  ).filter(Boolean);

  const discussionRightColumns = useMemo(() => {
    if (isNarrowScreen) return 1;
    // 4人想定：移動（スクロール）なしで収めるため2列にする
    if (orderedParticipants.length > 0 && orderedParticipants.length <= 4) return 2;
    return 1;
  }, [isNarrowScreen, orderedParticipants.length]);

  const unvotedCount = useMemo(() => {
    if (phase !== "voting") return 0;
    if (!currentCard) return 0;
    if (orderedParticipants.length === 0) return 0;
    return orderedParticipants.reduce((acc, name) => acc + (votesForCurrent.has(name) ? 0 : 1), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentCard?.cardId, orderedParticipants.join("|"), votesForCurrent]);

  const areaLists = useMemo(() => {
    const by: Record<string, typeof cards> = {
      go: [],
      no: [],
      neutral: [],
      vs: [],
      unassigned: [],
    };
    for (const c of cards) {
      const st = assignments[c.cardId] ?? autoAssignments[c.cardId] ?? "neutral";
      (by[st] || by.unassigned).push(c);
    }
    return by;
  }, [cards, assignments, autoAssignments]);

  const boardSections = useMemo(() => {
    return [
      // mobile2の配色に寄せる
      { key: "go", label: "行きたい", bg: "#f0fdf4", border: "#16a34a" },
      { key: "no", label: "行きたくない", bg: "#fef2f2", border: "#ef4444" },
      // VSは配色自由（要件的には見やすければOK）
      { key: "vs", label: "議論中", bg: "#f1f5f9", border: "#64748b" },
      { key: "neutral", label: "どちらでもいい", bg: "#fffbeb", border: "#f59e0b" },
    ] as const;
  }, []);

  const selectedCard = useMemo(() => {
    if (!selectedCardId) return null;
    return cards.find((c) => c.cardId === selectedCardId) ?? null;
  }, [selectedCardId, cards]);

  const onSelectCard = (cardId: string) => {
    setSelectedCardId(cardId);
  };

  const canStartDiscussion = phase === "voting" && !!selectedCardId;

  const vsCount = ((areaLists as any).vs as typeof cards)?.length ?? 0;
  const canOpenResult = true;

  const closePreview = () => {
    setPreviewCardId(null);
    setPreviewIsBack(false);
  };

  const placementMeta = {
    want: { label: "行きたい", bg: "#dcfce7", color: "#166534", border: "#16a34a" },
    neutral: { label: "どちらでもいい", bg: "#fef3c7", color: "#92400e", border: "#f59e0b" },
    dont: { label: "行きたくない", bg: "#fee2e2", color: "#991b1b", border: "#ef4444" },
    none: { label: "未提出", bg: "#e5e7eb", color: "#334155", border: "#94a3b8" },
  } as const;

  const endDiscussionAndReturnToBoard = async () => {
    if (!roomId || typeof roomId !== "string") return;
    await setDoc(
      doc(db, "rooms", roomId, STATE_DOC, "state"),
      addAuthKey({ stage: "board", lastMove: null, updatedAt: serverTimestamp() }),
      { merge: true }
    );
    setSelectedCardId(null);
    setIsCompactWindow(false);
  };

  // 旧「議論終了」ステージが残っている部屋でもウィンドウを出さずに盤面へ戻す
  useEffect(() => {
    if (phase !== "voting") return;
    if (stage !== "discussionEnd") return;
    endDiscussionAndReturnToBoard().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stage]);

  if (!roomId) return null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        backgroundColor: "#fff",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        boxSizing: "border-box",
        fontFamily: "Arial, sans-serif",
        overscrollBehavior: "none",
      }}
    >
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1600,
            padding: "10px 12px",
            borderRadius: "14px",
            backgroundColor: "rgba(15,23,42,0.92)",
            color: "#fff",
            fontWeight: 900,
            maxWidth: "min(560px, calc(100% - 24px))",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
          }}
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      <div style={{ width: "100%", maxWidth: "560px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ fontWeight: 900, fontSize: "1.25rem", color: "#0f172a" }}>議論していきましょう！</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {orderedParticipants.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {orderedParticipants.slice(0, 4).map((name) => (
                  <button
                    key={`head-${name}`}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 9999,
                      border: "1px solid rgba(15,23,42,0.14)",
                      background: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 900,
                      color: "#0f172a",
                      boxShadow: "0 2px 10px rgba(15,23,42,0.10)",
                      cursor: "pointer",
                    }}
                    title={name}
                    aria-label={`${name}のmobile2最終結果を見る`}
                    onClick={() => {
                      setSubmittedActiveUser(name);
                      setShowSubmittedResults(true);
                    }}
                  >
                    {(name?.[0] || "?").toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 1ページ目/2ページ目：盤面（選択で枠がつく） */}
        <div style={{ marginTop: 8 }}>
          {boardSections.map((sec) => {
            const list = (areaLists as any)[sec.key] as typeof cards;
            const isNeutral = sec.key === "neutral";
            const cardWidth = isNeutral ? 84 : 112;
            const showList = isNeutral ? list.slice(0, 6) : list;
            return (
              <div
                key={sec.key}
                style={{
                  border: `2px solid ${sec.border}`,
                  background: sec.bg,
                  borderRadius: 12,
                  padding: 10,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>
                    {sec.label}
                  </div>
                  <div style={{ fontWeight: 900, color: "#0f172a", opacity: 0.9 }}>
                    {list.length}
                  </div>
                </div>

                {showList.length === 0 ? (
                  <div style={{ color: "rgba(15,23,42,0.55)", fontWeight: 800, fontSize: 12 }}>
                    （なし）
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      overflowX: "auto",
                      paddingBottom: 6,
                      WebkitOverflowScrolling: "touch",
                    }}
                  >
                    {showList.map((c) => {
                      const isSelected = selectedCardId === c.cardId;
                      return (
                        <button
                          key={c.cardId}
                          onClick={() => onSelectCard(c.cardId)}
                          style={{
                            width: cardWidth,
                            flex: "0 0 auto",
                            background: "#fff",
                            borderRadius: 12,
                            padding: 8,
                            border: isSelected ? "3px solid #f97316" : "1px solid rgba(15,23,42,0.14)",
                            boxShadow: isSelected ? "0 0 0 3px rgba(249,115,22,0.25)" : "0 2px 10px rgba(15,23,42,0.10)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                          aria-label={`${c.title}を選択`}
                        >
                          <div style={{ width: "100%", aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", background: "#f1f5f9" }}>
                            <img
                              src={c.frontSrc}
                              alt={c.title}
                              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                              draggable={false}
                            />
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              fontWeight: 900,
                              fontSize: 12,
                              color: "#0f172a",
                              lineHeight: 1.2,
                              overflow: "hidden",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical" as any,
                            }}
                          >
                            {c.title}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>

      {/* 下部：議論開始 / 結果を見る */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
          paddingTop: 12,
          paddingLeft: 16,
          paddingRight: 16,
          backgroundColor: "rgba(255,255,255,0.92)",
          borderTop: "1px solid rgba(15,23,42,0.12)",
          backdropFilter: "blur(8px)",
          zIndex: 1200,
        }}
      >
        <div style={{ width: "100%", maxWidth: "560px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button
              onClick={() => {
                if (!selectedCardId) return;
                startDiscussion(selectedCardId).catch(() => {});
              }}
              disabled={!canStartDiscussion}
              style={{
                width: "100%",
                minHeight: 56,
                borderRadius: 14,
                border: "none",
                backgroundColor: canStartDiscussion ? "#0ea5e9" : "#94a3b8",
                color: "#fff",
                fontWeight: 900,
                cursor: canStartDiscussion ? "pointer" : "not-allowed",
                fontSize: 18,
              }}
            >
              議論を開始する
            </button>

            <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
              <button
                onClick={() => {
                  if (!canOpenResult) return;
                  if (vsCount > 0) {
                    setShowVsWarning(true);
                    return;
                  }
                  router.push(`/room/${roomId}/result`);
                }}
                disabled={!canOpenResult}
                style={{
                  flex: "1 1 auto",
                  width: "100%",
                  minHeight: 56,
                  borderRadius: 14,
                  border: "none",
                  backgroundColor: canOpenResult ? "#0f172a" : "#94a3b8",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: canOpenResult ? "pointer" : "not-allowed",
                  fontSize: 18,
                }}
              >
                結果を見る
              </button>

              <MapButton variant="inline" showLabel={false} />
            </div>
          </div>

          {!selectedCardId && !canFinish && (
            <div style={{ marginTop: 8, fontWeight: 900, fontSize: 12, color: "#64748b" }}>
              カードをタップして選択してください
            </div>
          )}
          {selectedCardId && !canFinish && (
            <div style={{ marginTop: 8, fontWeight: 900, fontSize: 12, color: "#334155" }}>
              選択中：{selectedCard?.title || selectedCardId}
            </div>
          )}
          {!canFinish && vsCount > 0 && (
            <div style={{ marginTop: 6, fontWeight: 900, fontSize: 12, color: "#b45309" }}>
              VSが残っています（全て解消しないと終了できません）
            </div>
          )}
        </div>
      </div>

      {/* 3ページ目：議論モーダル（投票） */}
      {phase === "voting" && stage === "discussion" && currentCard && !isCompactWindow && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.72)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(760px, 100%)",
              background: "#fff",
              borderRadius: 22,
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
              maxHeight: "90dvh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(15,23,42,0.12)",
                fontWeight: 900,
                gap: 10,
              }}
            >
              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentCard.title}</div>
              <button
                onClick={() => setIsCompactWindow(true)}
                style={{
                  minHeight: 34,
                  padding: "0 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(15,23,42,0.14)",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                小ウィンドウ化
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isNarrowScreen ? "1fr" : "1fr 1fr",
                  gap: 12,
                  padding: 14,
                  boxSizing: "border-box",
                }}
              >
              <div
                onClick={() => setIsBack((v) => !v)}
                style={{
                  width: "100%",
                  height: isNarrowScreen ? "min(46dvh, 460px)" : "min(52dvh, 520px)",
                  borderRadius: 16,
                  overflow: "hidden",
                  backgroundColor: "#f1f5f9",
                  position: "relative",
                  perspective: "1000px",
                  boxShadow: "0 14px 50px rgba(0,0,0,0.18)",
                  cursor: "pointer",
                }}
                role="button"
                tabIndex={0}
                aria-label="カードをタップして表裏を切り替え"
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transformStyle: "preserve-3d",
                    transition: "transform 260ms ease",
                    transform: `rotateY(${isBack ? 180 : 0}deg)`,
                  }}
                >
                  <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}>
                    <img
                      src={currentCard.frontSrc}
                      alt={currentCard.title}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      draggable={false}
                    />
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      transform: "rotateY(180deg)",
                    }}
                  >
                    <img
                      src={currentCard.backSrc}
                      alt={`${currentCard.title} 裏面`}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      draggable={false}
                    />
                  </div>
                </div>

                <div
                  style={{
                    position: "absolute",
                    bottom: 10,
                    left: 10,
                    padding: "8px 10px",
                    borderRadius: 12,
                    backgroundColor: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                >
                  タップで{isBack ? "表" : "裏"}
                </div>
              </div>

              <div style={{ width: "100%", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>
                  mobile2の振り分け（理由）
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: discussionRightColumns === 2 ? "repeat(2, minmax(0, 1fr))" : "1fr",
                    gap: discussionRightColumns === 2 ? 8 : 10,
                    overflowY: discussionRightColumns === 2 ? "hidden" : "auto",
                    paddingRight: discussionRightColumns === 2 ? 0 : 4,
                    minHeight: 0,
                    alignContent: "start",
                  }}
                >
                  {orderedParticipants.map((name) => {
                    const userSel = submittedSelections.find((u) => u.userName === name);
                    const placement = userSel?.placementByCardId?.[currentCard.cardId] ?? null;
                    const meta = placement ? placementMeta[placement.area] : placementMeta.none;
                    const reasonText = placement?.reason?.trim() || "";
                    return (
                      <div
                        key={`vote-${name}`}
                        style={{
                          borderRadius: 12,
                          border: `2px solid ${meta.border}`,
                          background: "#fff",
                          padding: discussionRightColumns === 2 ? "8px 10px" : "10px 12px",
                          fontWeight: 900,
                          color: "#0f172a",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div style={{ color: "#0f172a", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                          <div
                            style={{
                              flexShrink: 0,
                              padding: discussionRightColumns === 2 ? "3px 8px" : "4px 10px",
                              borderRadius: 999,
                              background: meta.bg,
                              border: `2px solid ${meta.border}`,
                              color: meta.color,
                              fontWeight: 900,
                              fontSize: 12,
                            }}
                          >
                            {meta.label}
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: discussionRightColumns === 2 ? 6 : 8,
                            borderRadius: 10,
                            background: meta.bg,
                            border: `1px solid ${meta.border}`,
                            padding: discussionRightColumns === 2 ? "6px 8px" : "8px 10px",
                          }}
                        >
                          <div style={{ fontWeight: 900, fontSize: 12, color: meta.color, marginBottom: discussionRightColumns === 2 ? 2 : 4 }}>理由</div>
                          <div
                            style={{
                              fontWeight: 900,
                              fontSize: 12,
                              color: "rgba(15,23,42,0.82)",
                              whiteSpace: "pre-wrap",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical" as any,
                              overflow: "hidden",
                            }}
                          >
                            {reasonText || "（なし）"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              </div>
            </div>

            <div
              style={{
                borderTop: "1px solid rgba(15,23,42,0.12)",
                padding: 14,
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                <button
                  onClick={() => castVote("go")}
                  style={{
                    minHeight: 56,
                    borderRadius: 16,
                    border: "none",
                    background: "#22c55e",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontSize: 18,
                  }}
                >
                  行く
                </button>
                <button
                  onClick={() => castVote("neutral")}
                  style={{
                    minHeight: 56,
                    borderRadius: 16,
                    border: "none",
                    background: "#fb923c",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontSize: 18,
                  }}
                >
                  保留
                </button>
                <button
                  onClick={() => castVote("no")}
                  style={{
                    minHeight: 56,
                    borderRadius: 16,
                    border: "none",
                    background: "#fb7185",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                    fontSize: 18,
                  }}
                >
                  行かない
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 8 }}>
                <div>{renderVoteAvatars("go")}</div>
                <div>{renderVoteAvatars("neutral")}</div>
                <div>{renderVoteAvatars("no")}</div>
              </div>
              <div style={{ marginTop: 10, fontWeight: 900, color: "#334155" }}>
                あなたの投票：{myVote ? (myVote === "go" ? "行く" : myVote === "no" ? "行かない" : "保留") : "未投票"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 小ウィンドウ化（3ページ目）：モーダルを閉じて左下にカード名＋戻す */}
      {phase === "voting" && stage === "discussion" && currentCard && isCompactWindow && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)",
            zIndex: 1950,
            background: "rgba(255,255,255,0.95)",
            border: "1px solid rgba(15,23,42,0.12)",
            borderRadius: 14,
            boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
            padding: "10px 12px",
            maxWidth: "min(320px, calc(100vw - 32px))",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 12, color: "#334155", marginBottom: 6 }}>議論中</div>
          <div style={{ fontWeight: 900, fontSize: 13, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {currentCard.title}
          </div>
          <button
            onClick={() => setIsCompactWindow(false)}
            style={{
              marginTop: 8,
              width: "100%",
              minHeight: 36,
              borderRadius: 10,
              border: "none",
              background: "#0f172a",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            戻す
          </button>
        </div>
      )}

      {/* 4ページ目：投票後 */}
      {phase === "voting" && stage === "afterVote" && state.lastMove && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.72)",
            zIndex: 2050,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "min(620px, 100%)",
              background: "#fff",
              borderRadius: 26,
              padding: 28,
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 22, color: "#0f172a", marginTop: 10 }}>
              {state.lastMove.title} は {statusLabel(state.lastMove.status)} に移動しました！
            </div>
            <button
              onClick={() => endDiscussionAndReturnToBoard().catch(() => {})}
              style={{
                width: "100%",
                marginTop: 22,
                minHeight: 56,
                borderRadius: 14,
                border: "none",
                background: "#0ea5e9",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
                fontSize: 18,
              }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* 配置カードのプレビュー（盤面確認用） */}
      {previewCard && (
        <div
          onClick={() => {
            closePreview();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.68)",
            zIndex: 1800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(15,23,42,0.12)",
                fontWeight: 900,
                gap: 10,
              }}
            >
              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewCard.title}</div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => {
                    closePreview();
                  }}
                  style={{
                    minHeight: 36,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(15,23,42,0.14)",
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: 900,
                  }}
                >
                  閉じる
                </button>
              </div>
            </div>

            <div
              onClick={() => setPreviewIsBack((v) => !v)}
              style={{
                width: "100%",
                aspectRatio: "3/4",
                background: "#f1f5f9",
                cursor: "pointer",
                position: "relative",
              }}
              role="button"
              tabIndex={0}
              aria-label="タップで表裏を切り替え"
            >
              <img
                src={previewIsBack ? previewCard.backSrc : previewCard.frontSrc}
                alt={previewCard.title}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                draggable={false}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 10,
                  left: 10,
                  padding: "8px 10px",
                  borderRadius: 12,
                  background: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: 12,
                }}
              >
                タップで{previewIsBack ? "表" : "裏"}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* mobile2の最終結果（提出内容） */}
      {showSubmittedResults && (
        <div
          onClick={() => setShowSubmittedResults(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.72)",
            zIndex: 2200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 100%)",
              maxHeight: "min(84dvh, 860px)",
              background: "#fff",
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 14px",
                borderBottom: "1px solid rgba(15,23,42,0.12)",
                fontWeight: 900,
                gap: 10,
              }}
            >
              <div style={{ fontWeight: 900, color: "#0f172a" }}>mobile2の最終結果</div>
              <button
                onClick={() => setShowSubmittedResults(false)}
                style={{
                  minHeight: 36,
                  padding: "0 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(15,23,42,0.14)",
                  background: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                閉じる
              </button>
            </div>

            <div style={{ padding: 14, overflow: "auto" }}>
              {submittedSelections.length === 0 ? (
                <div style={{ fontWeight: 900, color: "#64748b" }}>（まだ提出結果がありません）</div>
              ) : (
                <div style={{ display: "grid", gap: 14 }}>
                  {submittedSelections
                    .filter((u) => (submittedActiveUser ? u.userName === submittedActiveUser : true))
                    .map((u) => {
                    const renderRow = (label: string, ids: string[], bg: string) => (
                      <div style={{ borderRadius: 14, border: "1px solid rgba(15,23,42,0.12)", overflow: "hidden" }}>
                        <div style={{ padding: "8px 10px", fontWeight: 900, background: bg, color: "#0f172a" }}>
                          {label}（{ids.length}）
                        </div>
                        <div style={{ padding: 10 }}>
                          {ids.length === 0 ? (
                            <div style={{ fontWeight: 800, color: "#94a3b8", fontSize: 12 }}>(なし)</div>
                          ) : (
                            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 6 }}>
                              {ids.map((cid) => {
                                const card = cards.find((c) => c.cardId === cid);
                                if (!card) return null;
                                return (
                                  <div key={`${u.userName}-${label}-${cid}`} style={{ width: 72, flex: "0 0 auto" }}>
                                    <div style={{ width: "100%", aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", background: "#f1f5f9", border: "1px solid rgba(15,23,42,0.12)" }}>
                                      <img src={card.frontSrc} alt={card.title} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} draggable={false} />
                                    </div>
                                    <div
                                      style={{
                                        marginTop: 6,
                                        fontWeight: 900,
                                        fontSize: 11,
                                        color: "#0f172a",
                                        lineHeight: 1.2,
                                        overflow: "hidden",
                                        display: "-webkit-box",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical" as any,
                                      }}
                                    >
                                      {card.title}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );

                    return (
                      <div key={`submitted-${u.userName}`} style={{ borderRadius: 16, border: "2px solid rgba(15,23,42,0.12)", padding: 12 }}>
                        <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>{u.userName}</div>
                        <div style={{ display: "grid", gap: 10 }}>
                          {renderRow("行きたい", u.want, "#dcfce7")}
                          {renderRow("どちらでもいい", u.neutral, "#fffbeb")}
                          {renderRow("行きたくない", u.dont, "#fee2e2")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 結果を見る：VSが残っている場合の警告 */}
      {showVsWarning && (
        <div
          onClick={() => setShowVsWarning(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.72)",
            zIndex: 2250,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              background: "#fff",
              borderRadius: 18,
              padding: 18,
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 20, color: "#0f172a" }}>VSのカードを議論しましょう</div>
            <div style={{ marginTop: 10, fontWeight: 900, color: "#334155" }}>まだVSが {vsCount} 枚残っています</div>
            <button
              onClick={() => setShowVsWarning(false)}
              style={{
                width: "100%",
                marginTop: 18,
                minHeight: 52,
                borderRadius: 14,
                border: "none",
                background: "#0f172a",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
