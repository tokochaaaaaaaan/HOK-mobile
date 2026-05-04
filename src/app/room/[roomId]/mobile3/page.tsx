"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { activeCards } from "@/data/cards";
import { useUser } from "@/context/UserContext";
import MapButton from "@/components/MapButton";
import { getCardTitleText, getFuriganaText } from "@/components/FuriganaText";
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
type AssignmentDoc = { status: AssignmentStatus; decidedBy?: string | null };

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
  const [hasLoadedRoomState, setHasLoadedRoomState] = useState(false);
  const [votes, setVotes] = useState<Array<{ id: string; sessionId: string; cardId: string; userId: string; vote: VoteChoice }>>([]);
  const [assignments, setAssignments] = useState<Record<string, AssignmentDoc>>({});

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewIsBack, setPreviewIsBack] = useState(false);

  const [isNarrowScreen, setIsNarrowScreen] = useState(false);

  const [isBack, setIsBack] = useState(false);
  const [toast, setToast] = useState<React.ReactNode | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [encouragementIndex, setEncouragementIndex] = useState(0);
  const [showMissionComplete, setShowMissionComplete] = useState(false);
  const [showResultCta, setShowResultCta] = useState(false);
  const missionCompleteTriggeredRef = useRef(false);
  const missionCompleteTimerRef = useRef<number | null>(null);
  const celebrationAudioContextRef = useRef<AudioContext | null>(null);

  // afterVoteの「閉じる」は各ユーザー（各端末）で完結させる
  const [dismissedAfterVoteKey, setDismissedAfterVoteKey] = useState<string | null>(null);

  const [showSubmittedResults, setShowSubmittedResults] = useState(false);
  const [hasLoadedSubmittedSelections, setHasLoadedSubmittedSelections] = useState(false);
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
  const [showAllCardsModal, setShowAllCardsModal] = useState(false);
  const [deckRevealCardId, setDeckRevealCardId] = useState<string | null>(null);
  const [deckRevealFlipped, setDeckRevealFlipped] = useState(false);
  const [hasCompletedInitialDiscussionGate, setHasCompletedInitialDiscussionGate] = useState(false);
  const deckFlipTimerRef = useRef<number | null>(null);
  const deckOpenTimerRef = useRef<number | null>(null);
  const deckAutoStartTimerRef = useRef<number | null>(null);
  const initialDiscussionGateTimerRef = useRef<number | null>(null);

  const encouragementMessages = ["どんどん行こう！", "その調子！", "みんなで解決しよう！"];

  const showToast = (msg: React.ReactNode) => {
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
      setHasLoadedRoomState(true);
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
      const map: Record<string, AssignmentDoc> = {};
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const status = String(data?.status || "").trim();
        if (status === "go" || status === "no" || status === "neutral" || status === "vs") {
          map[d.id] = {
            status,
            decidedBy: typeof data?.decidedBy === "string" ? String(data.decidedBy) : null,
          };
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

      setHasLoadedSubmittedSelections(true);
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
      .filter((cid) => {
        const st = assignments[cid]?.status;
        return !(st === "go" || st === "no" || st === "neutral" || st === "vs");
      });
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

  // mobile2の全員提出から自動分類した結果を play3Assignments に同期する
  // - 目的：行きたい×行きたくないのコンフリクトが起きたカードを「議論中(VS)」へ送る
  // - ただし、mobile3で投票確定したカード（decidedBy === 'mobile3'）は上書きしない
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    if (submittedSelections.length === 0) return;

    (async () => {
      for (const c of cards) {
        const desired: AssignmentStatus = (autoAssignments[c.cardId] || "neutral") as AssignmentStatus;
        const cur = assignments[c.cardId];
        const curStatus = cur?.status;
        const decidedBy = typeof cur?.decidedBy === "string" ? cur.decidedBy : null;

        if (decidedBy === "mobile3") continue;

        // legacy/autoのものだけ同期（未設定も対象にする）
        const isAuto = !decidedBy || decidedBy === "autoMobile2";
        if (!isAuto) continue;

        if (!curStatus || curStatus !== desired) {
          await setDoc(
            doc(db, "rooms", roomId, "play3Assignments", c.cardId),
            addAuthKey({
              status: desired,
              decidedBy: "autoMobile2",
              updatedAt: serverTimestamp(),
            }),
            { merge: true }
          );
        }
      }
    })().catch(() => {});
  }, [roomId, submittedSelections.length, cards, assignments, autoAssignments]);

  const phase: "voting" | "finished" = state.phase === "finished" ? "finished" : "voting";
  const stage: UiStage =
    state.stage === "discussion" || state.stage === "afterVote" || state.stage === "discussionEnd" ? state.stage : "board";

  const afterVoteKey = useMemo(() => {
    if (phase !== "voting") return null;
    if (stage !== "afterVote") return null;
    if (!state.lastMove) return null;
    const movedBy = typeof state.lastMove.movedBy === "string" ? state.lastMove.movedBy : "";
    return `${state.lastMove.cardId}__${state.lastMove.status}__${movedBy}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, stage, state.lastMove?.cardId, state.lastMove?.status, state.lastMove?.movedBy]);

  const canUseBoardControls =
    stage === "board" || (stage === "afterVote" && !!afterVoteKey && dismissedAfterVoteKey === afterVoteKey);

  const currentCard = useMemo(() => {
    const cid = typeof state.cardId === "string" ? state.cardId : null;
    if (!cid) return null;
    return cards.find((c) => c.cardId === cid) ?? null;
  }, [state.cardId, cards]);

  const previewCard = useMemo(() => {
    if (!previewCardId) return null;
    return cards.find((c) => c.cardId === previewCardId) ?? null;
  }, [previewCardId, cards]);

  const shouldDelayInitialDiscussionModal =
    hasLoadedRoomState &&
    !hasCompletedInitialDiscussionGate &&
    phase === "voting" &&
    stage === "discussion" &&
    !!currentCard;

  const discussionModalOpen = phase === "voting" && stage === "discussion" && !!currentCard && !shouldDelayInitialDiscussionModal;
  const afterVoteModalOpen = phase === "voting" && stage === "afterVote" && !!state.lastMove && !!afterVoteKey && dismissedAfterVoteKey !== afterVoteKey;
  useBodyScrollLock(discussionModalOpen || afterVoteModalOpen || !!previewCard || showSubmittedResults || showVsWarning || showAllCardsModal || showMissionComplete);

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

  const consensusVote = useMemo(() => {
    if (!currentCard) return null;
    const ordered = (expectedUserIds.length > 0 ? expectedUserIds : participants).filter(Boolean);
    if (ordered.length === 0) return null;

    const votesInOrder = ordered.map((name) => votesForCurrent.get(name) ?? null);
    if (votesInOrder.some((vote) => vote == null)) return null;

    const firstVote = votesInOrder[0];
    if (firstVote !== "go" && firstVote !== "no") return null;
    return votesInOrder.every((vote) => vote === firstVote) ? firstVote : null;
  }, [currentCard, expectedUserIds, participants, votesForCurrent]);

  const canFinish = useMemo(() => {
    if (cards.length === 0) return false;
    return cards.every((c) => {
      const st = assignments[c.cardId]?.status;
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
    return "VS";
  };

  const finalizeCurrentIfReady = async () => {
    if (!roomId || typeof roomId !== "string") return;
    if (!currentCard) return;
    if (expectedCount < 1) return;
    if (stage !== "discussion") return;
    if (!state.sessionId) return;
    if (!consensusVote) return;

    const finalStatus: AssignmentStatus = consensusVote === "go" ? "go" : "no";

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

    showToast(
      <>
        {getCardTitleText(currentCard.title)} のミッションは達成！
        <br />
        {getFuriganaText(finalStatus === "go" ? "行く" : "行かない")}ことになったよ！
      </>
    );
    setIsBack(false);
  };

  // 全員投票済みなら自動確定
  useEffect(() => {
    if (phase !== "voting") return;
    if (!currentCard) return;
    if (stage !== "discussion") return;
    if (!consensusVote) return;
    finalizeCurrentIfReady().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentCard?.cardId, consensusVote, stage]);

  const startDiscussion = async (cardId: string) => {
    if (!roomId || typeof roomId !== "string") return;
    if (phase !== "voting") return;
    // 投票/議論中（小ウィンドウ含む）は新しい議論開始を禁止。
    // afterVoteは「閉じる」を各自が押した後だけ許可。
    if (!canUseBoardControls) return;
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
      const st = assignments[c.cardId]?.status ?? autoAssignments[c.cardId] ?? "neutral";
      (by[st] || by.unassigned).push(c);
    }
    return by;
  }, [cards, assignments, autoAssignments]);

  const remainingVsAfterLastMoveCount = useMemo(() => {
    return cards.reduce((count, card) => {
      const effectiveStatus: AssignmentStatus =
        stage === "afterVote" && state.lastMove?.cardId === card.cardId
          ? state.lastMove.status
          : assignments[card.cardId]?.status ?? autoAssignments[card.cardId] ?? "neutral";

      return count + (effectiveStatus === "vs" ? 1 : 0);
    }, 0);
  }, [assignments, autoAssignments, cards, stage, state.lastMove]);

  const boardSections = useMemo(() => {
    return [
      // mobile2の配色に寄せる
      { key: "go", label: "行きたい", bg: "#f0fdf4", border: "#16a34a" },
      { key: "no", label: "行きたくない", bg: "#fef2f2", border: "#ef4444" },
      // VSは配色自由（要件的には見やすければOK）
      { key: "vs", label: "VS", bg: "#f1f5f9", border: "#64748b" },
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

  const vsCount = ((areaLists as any).vs as typeof cards)?.length ?? 0;
  const vsCards = ((areaLists as any).vs as typeof cards) ?? [];
  const initialVsCount = useMemo(() => {
    return cards.reduce((count, card) => count + (autoAssignments[card.cardId] === "vs" ? 1 : 0), 0);
  }, [autoAssignments, cards]);
  const selectedVsCard = useMemo(() => vsCards.find((c) => c.cardId === selectedCardId) ?? null, [vsCards, selectedCardId]);
  const nextDeckCard = selectedVsCard ?? vsCards[0] ?? null;
  const deckRevealCard = useMemo(() => {
    if (!deckRevealCardId) return null;
    return cards.find((c) => c.cardId === deckRevealCardId) ?? null;
  }, [cards, deckRevealCardId]);
  const deckDisplayCard = deckRevealCard ?? nextDeckCard ?? currentCard;
  const canStartDiscussion = phase === "voting" && canUseBoardControls && !!nextDeckCard;
  const canOpenResult = showResultCta && canFinish;

  useEffect(() => {
    if (stage !== "board") return;
    if (!canUseBoardControls) return;
    if (vsCards.length === 0) {
      if (selectedCardId) setSelectedCardId(null);
      return;
    }
    if (!selectedCardId || !vsCards.some((c) => c.cardId === selectedCardId)) {
      setSelectedCardId(vsCards[0].cardId);
    }
  }, [canUseBoardControls, selectedCardId, stage, vsCards]);

  useEffect(() => {
    if (discussionModalOpen) {
      setDeckRevealCardId(null);
      setDeckRevealFlipped(false);
    }
  }, [discussionModalOpen]);

  useEffect(() => {
    return () => {
      if (deckFlipTimerRef.current) window.clearTimeout(deckFlipTimerRef.current);
      if (deckOpenTimerRef.current) window.clearTimeout(deckOpenTimerRef.current);
      if (deckAutoStartTimerRef.current) window.clearTimeout(deckAutoStartTimerRef.current);
      if (initialDiscussionGateTimerRef.current) window.clearTimeout(initialDiscussionGateTimerRef.current);
      if (missionCompleteTimerRef.current) window.clearTimeout(missionCompleteTimerRef.current);
      if (celebrationAudioContextRef.current) {
        void celebrationAudioContextRef.current.close().catch(() => undefined);
        celebrationAudioContextRef.current = null;
      }
    };
  }, []);

  const startDeckDiscussion = () => {
    if (!nextDeckCard) return;
    if (!canUseBoardControls) return;
    if (deckRevealCardId) return;

    setEncouragementIndex((prev) => (prev + 1) % encouragementMessages.length);
    setSelectedCardId(nextDeckCard.cardId);
    setDeckRevealCardId(nextDeckCard.cardId);
    setDeckRevealFlipped(false);

    if (deckFlipTimerRef.current) window.clearTimeout(deckFlipTimerRef.current);
    if (deckOpenTimerRef.current) window.clearTimeout(deckOpenTimerRef.current);

    deckFlipTimerRef.current = window.setTimeout(() => {
      setDeckRevealFlipped(true);
    }, 40);

    deckOpenTimerRef.current = window.setTimeout(() => {
      startDiscussion(nextDeckCard.cardId).catch(() => {
        setDeckRevealCardId(null);
        setDeckRevealFlipped(false);
      });
    }, 720);
  };

  const ensureCelebrationAudioReady = async () => {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    if (!celebrationAudioContextRef.current) celebrationAudioContextRef.current = new AudioCtor();
    if (celebrationAudioContextRef.current.state === "suspended") {
      await celebrationAudioContextRef.current.resume().catch(() => undefined);
    }
    return celebrationAudioContextRef.current;
  };

  const playMissionCompleteSound = async () => {
    const ctx = await ensureCelebrationAudioReady();
    if (!ctx) return;

    const pulse = (frequency: number, startOffset: number, duration: number, type: OscillatorType, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = ctx.currentTime + startOffset;
      const endAt = startAt + duration;
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, startAt);
      osc.frequency.exponentialRampToValueAtTime(frequency * 1.25, endAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + duration * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt);
    };

    pulse(520, 0, 0.18, "triangle", 0.04);
    pulse(680, 0.14, 0.2, "triangle", 0.04);
    pulse(860, 0.28, 0.22, "sine", 0.035);
    pulse(1080, 0.44, 0.3, "sine", 0.03);
  };

  useEffect(() => {
    if (!nextDeckCard) return;
    if (!canUseBoardControls) return;
    if (discussionModalOpen || afterVoteModalOpen || showAllCardsModal || showVsWarning) return;
    if (deckRevealCardId) return;

    if (deckAutoStartTimerRef.current) window.clearTimeout(deckAutoStartTimerRef.current);
    deckAutoStartTimerRef.current = window.setTimeout(() => {
      startDeckDiscussion();
    }, 520);

    return () => {
      if (deckAutoStartTimerRef.current) {
        window.clearTimeout(deckAutoStartTimerRef.current);
        deckAutoStartTimerRef.current = null;
      }
    };
  }, [afterVoteModalOpen, canUseBoardControls, deckRevealCardId, discussionModalOpen, nextDeckCard?.cardId, showAllCardsModal, showVsWarning]);

  useEffect(() => {
    if (!hasLoadedRoomState) return;
    if (hasCompletedInitialDiscussionGate) return;

    if (!(phase === "voting" && stage === "discussion" && currentCard)) {
      setHasCompletedInitialDiscussionGate(true);
      return;
    }

    setSelectedCardId(currentCard.cardId);
    setDeckRevealCardId(currentCard.cardId);
    setDeckRevealFlipped(false);

    if (deckFlipTimerRef.current) window.clearTimeout(deckFlipTimerRef.current);
    if (initialDiscussionGateTimerRef.current) window.clearTimeout(initialDiscussionGateTimerRef.current);

    deckFlipTimerRef.current = window.setTimeout(() => {
      setDeckRevealFlipped(true);
    }, 40);

    initialDiscussionGateTimerRef.current = window.setTimeout(() => {
      setHasCompletedInitialDiscussionGate(true);
      initialDiscussionGateTimerRef.current = null;
    }, 920);

    return () => {
      if (initialDiscussionGateTimerRef.current) {
        window.clearTimeout(initialDiscussionGateTimerRef.current);
        initialDiscussionGateTimerRef.current = null;
      }
    };
  }, [currentCard, hasCompletedInitialDiscussionGate, hasLoadedRoomState, phase, stage]);

  useEffect(() => {
    if (phase !== "voting" || stage !== "board") return;
    if (!hasLoadedSubmittedSelections) return;
    if (initialVsCount <= 0) return;
    if (vsCount > 0) return;
    if (discussionModalOpen || afterVoteModalOpen || showAllCardsModal || !!previewCard) return;
    if (missionCompleteTriggeredRef.current) return;

    missionCompleteTriggeredRef.current = true;
    setShowMissionComplete(true);
    setShowResultCta(true);
    void playMissionCompleteSound();

    return () => {
      if (missionCompleteTimerRef.current) {
        window.clearTimeout(missionCompleteTimerRef.current);
        missionCompleteTimerRef.current = null;
      }
    };
  }, [afterVoteModalOpen, discussionModalOpen, hasLoadedSubmittedSelections, initialVsCount, phase, previewCard, showAllCardsModal, stage, vsCount]);

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
  };

  const openMissionCompleteOverlay = () => {
    if (initialVsCount <= 0) return;
    if (missionCompleteTriggeredRef.current) return;

    missionCompleteTriggeredRef.current = true;
    setShowMissionComplete(true);
    setShowResultCta(true);
    void playMissionCompleteSound();
  };

  const handleAfterVoteClose = () => {
    if (afterVoteKey) {
      setDismissedAfterVoteKey(afterVoteKey);
    }

    if (initialVsCount <= 0) return;
    if (remainingVsAfterLastMoveCount !== 0) return;
    openMissionCompleteOverlay();
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
      <style>{`
        @keyframes mobile3CelebrateFloat {
          0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(0.9); opacity: 0; }
          12% { opacity: 1; }
          100% { transform: translate3d(var(--driftX), var(--driftY), 0) rotate(var(--spin)) scale(1.15); opacity: 0; }
        }
        @keyframes mobile3CelebratePulse {
          0% { transform: scale(0.86); opacity: 0.35; }
          35% { transform: scale(1.04); opacity: 1; }
          100% { transform: scale(1.14); opacity: 0; }
        }
      `}</style>

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: "1.35rem", color: "#0f172a" }}>{getFuriganaText("ミッション！")}</div>
            <div style={{ marginTop: 6, fontWeight: 900, color: "#334155", lineHeight: 1.6 }}>
              {getFuriganaText("意見が分かれているカードを話し合って解決しよう！")}
            </div>
          </div>

        </div>

        <div
          style={{
            marginTop: 12,
            borderRadius: 24,
            border: "2px solid rgba(14,165,233,0.18)",
            background: "linear-gradient(180deg, #eff6ff 0%, #ffffff 56%, #f8fafc 100%)",
            boxShadow: "0 18px 46px rgba(14,165,233,0.12)",
            padding: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrowScreen ? "148px minmax(0, 1fr)" : "188px minmax(0, 1fr)",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "3 / 4.2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {deckDisplayCard ? (
                <>
                  {Array.from({ length: deckRevealCardId ? Math.max(Math.min(vsCards.length, 4) - 1, 0) : Math.min(vsCards.length, 4) }).map((_, index) => {
                    const reverseIndex = (deckRevealCardId ? Math.max(Math.min(vsCards.length, 4) - 1, 0) : Math.min(vsCards.length, 4)) - index - 1;
                    return (
                      <div
                        key={`deck-layer-${index}`}
                        style={{
                          position: "absolute",
                          inset: `${12 + reverseIndex * 5}px ${18 + reverseIndex * 3}px ${18 - reverseIndex * 3}px ${12 - reverseIndex * 2}px`,
                          borderRadius: 18,
                          overflow: "hidden",
                          background: "linear-gradient(180deg, #e2e8f0 0%, #cbd5e1 100%)",
                          border: "2px solid rgba(100,116,139,0.24)",
                          boxShadow: "0 10px 24px rgba(15,23,42,0.12)",
                        }}
                      >
                        <img
                          src={deckDisplayCard.backSrc}
                          alt="VSデッキ"
                          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", opacity: 0.96 }}
                          draggable={false}
                        />
                      </div>
                    );
                  })}

                  {deckRevealCard && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 8,
                        perspective: "1200px",
                        transform: deckRevealFlipped ? "translate(12%, -18%) scale(1.02)" : "translate(0, 0)",
                        transition: "transform 680ms cubic-bezier(0.22, 1, 0.36, 1)",
                        zIndex: 5,
                      }}
                    >
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "100%",
                          transformStyle: "preserve-3d",
                          transform: `rotateY(${deckRevealFlipped ? 180 : 0}deg)`,
                          transition: "transform 640ms cubic-bezier(0.22, 1, 0.36, 1)",
                          boxShadow: "0 24px 50px rgba(14,165,233,0.22)",
                          borderRadius: 20,
                        }}
                      >
                        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", borderRadius: 20, overflow: "hidden", background: "#dbeafe" }}>
                          <img src={deckRevealCard.backSrc} alt="VSデッキ" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} draggable={false} />
                        </div>
                        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", borderRadius: 20, overflow: "hidden", background: "#fff" }}>
                          <img src={deckRevealCard.frontSrc} alt={deckRevealCard.title} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} draggable={false} />
                        </div>
                      </div>
                    </div>
                  )}

                  {!deckRevealCard && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 8,
                        borderRadius: 20,
                        overflow: "hidden",
                        background: "#dbeafe",
                        border: "2px solid rgba(14,165,233,0.22)",
                        boxShadow: "0 20px 46px rgba(14,165,233,0.18)",
                      }}
                    >
                      <img src={deckDisplayCard.backSrc} alt="VSデッキ" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} draggable={false} />
                    </div>
                  )}

                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 4,
                      minWidth: 44,
                      height: 44,
                      borderRadius: 9999,
                      background: "#0f172a",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 900,
                      fontSize: "1rem",
                      boxShadow: "0 12px 30px rgba(15,23,42,0.22)",
                      zIndex: 7,
                    }}
                  >
                    {vsCards.length}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 20,
                    border: "2px dashed rgba(100,116,139,0.34)",
                    background: "rgba(255,255,255,0.78)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    padding: 12,
                    fontWeight: 900,
                    color: "#64748b",
                    lineHeight: 1.5,
                  }}
                >
                  VS するカードは<br />ありません
                </div>
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              {vsCards.length === 0 ? (
                <button
                  onClick={openMissionCompleteOverlay}
                  disabled={initialVsCount <= 0 || showMissionComplete}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    borderRadius: 9999,
                    background: showMissionComplete ? "rgba(250,204,21,0.18)" : "rgba(14,165,233,0.14)",
                    color: showMissionComplete ? "#a16207" : "#0369a1",
                    fontWeight: 900,
                    fontSize: 12,
                    border: "1px solid rgba(14,165,233,0.16)",
                    cursor: initialVsCount > 0 && !showMissionComplete ? "pointer" : "default",
                  }}
                >
                  クリア
                </button>
              ) : (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 9999, background: "rgba(14,165,233,0.14)", color: "#0369a1", fontWeight: 900, fontSize: 12 }}>
                  {vsCards.length > 1 ? "VS デッキ" : "さいごの 1まい"}
                </div>
              )}
              <div style={{ marginTop: 12, fontWeight: 900, fontSize: isNarrowScreen ? "1.15rem" : "1.28rem", color: "#0f172a", lineHeight: 1.4 }}>
                {deckDisplayCard ? "ページが はじまると デッキの いちばんうえが めくられるよ！" : encouragementMessages[encouragementIndex]}
              </div>
              <div style={{ marginTop: 10, borderRadius: 16, background: "rgba(255,255,255,0.84)", border: "1px solid rgba(148,163,184,0.26)", padding: "12px 14px" }}>
                <div style={{ fontWeight: 900, fontSize: 12, color: "#64748b", marginBottom: 6 }}>つぎに はなす カード</div>
                <div style={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.45 }}>
                  {deckDisplayCard ? getCardTitleText(deckDisplayCard.title) : "いまは ありません"}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 3ページ目：議論モーダル（投票） */}
      {discussionModalOpen && currentCard && (
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
            overflowY: "auto",
            overscrollBehavior: "contain",
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
              <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{getCardTitleText(currentCard.title)}</div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setShowAllCardsModal(true)}
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
                  {getFuriganaText("全カード一覧")}
                </button>
                <MapButton variant="inline" showLabel={false} />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
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
                  {getFuriganaText("mobile2の振り分け（理由）")}
                </div>
                <div
                  style={{
                    marginBottom: 10,
                    borderRadius: 12,
                    padding: "10px 12px",
                    background: "#eff6ff",
                    border: "1px solid rgba(14,165,233,0.24)",
                    fontWeight: 900,
                    color: "#0f172a",
                    lineHeight: 1.6,
                  }}
                >
                  {getFuriganaText("全員で意見を合わせることでミッションを達成できるよ！")}
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
                    overscrollBehavior: discussionRightColumns === 2 ? undefined : "contain",
                    WebkitOverflowScrolling: discussionRightColumns === 2 ? undefined : "touch",
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
                            {getFuriganaText(meta.label)}
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
                          <div style={{ fontWeight: 900, fontSize: 12, color: meta.color, marginBottom: discussionRightColumns === 2 ? 2 : 4 }}>{getFuriganaText("理由")}</div>
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
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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
                  行く！
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
                  行かない！
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 8 }}>
                <div>{renderVoteAvatars("go")}</div>
                <div>{renderVoteAvatars("no")}</div>
              </div>
              <div style={{ marginTop: 10, fontWeight: 900, color: "#334155" }}>
                {getFuriganaText("あなたの投票")}：{myVote ? getFuriganaText(myVote === "go" ? "行く" : "行かない") : getFuriganaText("未投票")}
              </div>
              <div style={{ marginTop: 8, fontWeight: 900, color: consensusVote ? "#15803d" : "#334155", lineHeight: 1.6 }}>
                {consensusVote
                  ? getFuriganaText("みんなの意見がそろったよ！")
                  : unvotedCount > 0
                    ? (
                        <>
                          <span>{unvotedCount}</span>
                          {getFuriganaText("人の投票を待っているよ")}
                        </>
                      )
                    : getFuriganaText("まだ意見がそろっていないよ。話し合って合わせよう！")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4ページ目：投票後 */}
      {phase === "voting" && stage === "afterVote" && state.lastMove && afterVoteKey && dismissedAfterVoteKey !== afterVoteKey && (
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
            overflowY: "auto",
            overscrollBehavior: "contain",
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
              {getCardTitleText(state.lastMove.title)} のミッションは達成！
              <br />
              {getFuriganaText(state.lastMove.status === "go" ? "行く" : "行かない")}ことになったよ！
            </div>
            <button
              onClick={handleAfterVoteClose}
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

      {showAllCardsModal && (
        <div
          onClick={() => setShowAllCardsModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.72)",
            zIndex: 2100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(680px, calc(100% - 20px))",
              background: "#fff",
              borderRadius: 22,
              boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
              overflow: "hidden",
              maxHeight: "min(82dvh, 760px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid rgba(15,23,42,0.12)", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: "1.2rem", color: "#0f172a" }}>{getFuriganaText("全カード一覧")}</div>
                <div style={{ marginTop: 4, fontWeight: 900, fontSize: 12, color: "#475569" }}>いまの しわけを まとめて みられるよ</div>
              </div>
              <button
                onClick={() => setShowAllCardsModal(false)}
                style={{ minHeight: 40, padding: "0 12px", borderRadius: 12, border: "1px solid rgba(15,23,42,0.14)", background: "#fff", cursor: "pointer", fontWeight: 900 }}
              >
                {getFuriganaText("閉じる")}
              </button>
            </div>

            <div style={{ padding: 14, display: "grid", gap: 12, overflowY: "auto", overscrollBehavior: "contain" }}>
              {[
                { key: "vs", label: "残りミッションカード", bg: "#f1f5f9", border: "#64748b", cards: vsCards },
                { key: "go", label: "行く", bg: "#f0fdf4", border: "#16a34a", cards: (areaLists as any).go as typeof cards },
                { key: "no", label: "行かない", bg: "#fef2f2", border: "#ef4444", cards: (areaLists as any).no as typeof cards },
                { key: "neutral", label: "どちらでもいい", bg: "#fffbeb", border: "#f59e0b", cards: (areaLists as any).neutral as typeof cards },
              ].map((section) => (
                <div key={section.key} style={{ border: `2px solid ${section.border}`, background: section.bg, borderRadius: 18, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{getFuriganaText(section.label)}</div>
                    <div style={{ fontWeight: 900, color: "#0f172a" }}>{section.cards.length}</div>
                  </div>

                  {section.cards.length === 0 ? (
                    <div style={{ fontWeight: 900, color: "#64748b", fontSize: 12 }}>（なし）</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: isNarrowScreen ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                      {section.cards.map((c) => (
                        <button
                          key={`${section.key}-${c.cardId}`}
                          onClick={() => {
                            setPreviewCardId(c.cardId);
                            setPreviewIsBack(false);
                          }}
                          style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(15,23,42,0.14)", padding: 7, textAlign: "left", cursor: "pointer", boxShadow: "0 4px 14px rgba(15,23,42,0.08)" }}
                        >
                          <div style={{ width: "100%", aspectRatio: "3/4", borderRadius: 10, overflow: "hidden", background: "#f8fafc" }}>
                            <img src={c.frontSrc} alt={c.title} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} draggable={false} />
                          </div>
                          <div style={{ marginTop: 6, fontWeight: 900, fontSize: 12, color: "#0f172a", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any }}>
                            {getCardTitleText(c.title)}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
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
            zIndex: 2200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              aspectRatio: "3 / 4",
              borderRadius: 18,
              overflow: "hidden",
              backgroundColor: "#f1f5f9",
              position: "relative",
              perspective: "1000px",
              boxShadow: "0 22px 70px rgba(0,0,0,0.35)",
            }}
            role="button"
            tabIndex={0}
            aria-label="カードをタップして表裏を切り替え"
          >
            <div
              onClick={() => setPreviewIsBack((v) => !v)}
              style={{
                width: "100%",
                height: "100%",
                cursor: "pointer",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transformStyle: "preserve-3d",
                  transition: "transform 260ms ease",
                  transform: `rotateY(${previewIsBack ? 180 : 0}deg)`,
                }}
              >
                <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}>
                  <img
                    src={previewCard.frontSrc}
                    alt={previewCard.title}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    draggable={false}
                  />
                </div>
                <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                  <img
                    src={previewCard.backSrc}
                    alt={`${previewCard.title} 裏面`}
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
                  background: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  fontWeight: 900,
                  fontSize: 12,
                }}
              >
                タップで{previewIsBack ? "表" : "裏"}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closePreview();
                }}
                style={{
                  position: "absolute",
                  top: 10,
                  left: 10,
                  minHeight: "40px",
                  padding: "0 12px",
                  borderRadius: "12px",
                  border: "1px solid rgba(255,255,255,0.35)",
                  backgroundColor: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {getFuriganaText("閉じる")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMissionComplete && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2300,
            background: "radial-gradient(circle at top, rgba(253,224,71,0.32), rgba(15,23,42,0.86) 58%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: 18 }).map((_, index) => {
            const colors = ["#22c55e", "#f97316", "#38bdf8", "#facc15", "#fb7185", "#a78bfa"];
            return (
              <div
                key={`celebrate-${index}`}
                style={{
                  position: "absolute",
                  top: `${18 + (index % 6) * 10}%`,
                  left: `${8 + (index % 9) * 10}%`,
                  width: index % 3 === 0 ? 18 : 12,
                  height: index % 3 === 0 ? 18 : 12,
                  borderRadius: index % 2 === 0 ? 9999 : 4,
                  background: colors[index % colors.length],
                  opacity: 0.9,
                  ['--driftX' as any]: `${(index % 2 === 0 ? 1 : -1) * (40 + (index % 4) * 18)}px`,
                  ['--driftY' as any]: `${180 + (index % 5) * 26}px`,
                  ['--spin' as any]: `${index % 2 === 0 ? 240 : -240}deg`,
                  animation: `mobile3CelebrateFloat ${1.8 + (index % 4) * 0.24}s ease-out infinite`,
                  animationDelay: `${index * 0.06}s`,
                }}
              />
            );
          })}

          <div
            style={{
              position: "absolute",
              width: 240,
              height: 240,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255,255,255,0.92), rgba(255,255,255,0) 68%)",
              animation: "mobile3CelebratePulse 1.8s ease-out infinite",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "relative",
              zIndex: 2,
              width: "min(560px, 100%)",
              borderRadius: 28,
              background: "linear-gradient(180deg, #ffffff 0%, #fefce8 100%)",
              border: "3px solid rgba(250,204,21,0.68)",
              boxShadow: "0 30px 90px rgba(0,0,0,0.34)",
              padding: "28px 20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: "clamp(2rem, 8vw, 3rem)", color: "#ca8a04", lineHeight: 1.15 }}>
              {getFuriganaText("全ミッション達成！")}
            </div>
            {showResultCta && (
              <button
                onClick={() => {
                  if (!canOpenResult) return;
                  router.push(`/room/${roomId}/result`);
                }}
                style={{
                  width: "100%",
                  minHeight: 56,
                  marginTop: 22,
                  borderRadius: 16,
                  border: "none",
                  background: "linear-gradient(135deg, #16a34a, #15803d)",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: canOpenResult ? "pointer" : "not-allowed",
                  fontSize: 20,
                  boxShadow: "0 18px 38px rgba(22,163,74,0.28)",
                  letterSpacing: "0.04em",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span>{getFuriganaText("結果を見る")}</span>
                  <span style={{ fontSize: 24, lineHeight: 1 }} aria-hidden="true">&gt;</span>
                </span>
              </button>
            )}
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
            overflowY: "auto",
            overscrollBehavior: "contain",
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
              <div style={{ fontWeight: 900, color: "#0f172a" }}>{getFuriganaText("mobile2の最終結果")}</div>
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

            <div style={{ padding: 14, overflow: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              {submittedSelections.length === 0 ? (
                <div style={{ fontWeight: 900, color: "#64748b" }}>（まだ提出結果がありません）</div>
              ) : (
                (() => {
                  const filtered = submittedSelections.filter((u) =>
                    submittedActiveUser ? u.userName === submittedActiveUser : true
                  );

                  const renderRow = (u: { userName: string }, label: string, ids: string[], bg: string) => (
                    <div style={{ borderRadius: 14, border: "1px solid rgba(15,23,42,0.12)", overflow: "hidden" }}>
                      <div style={{ padding: "8px 10px", fontWeight: 900, background: bg, color: "#0f172a" }}>
                        {getFuriganaText(label)}（{ids.length}）
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
                                  <div
                                    style={{
                                      width: "100%",
                                      aspectRatio: "3/4",
                                      borderRadius: 10,
                                      overflow: "hidden",
                                      background: "#f1f5f9",
                                      border: "1px solid rgba(15,23,42,0.12)",
                                    }}
                                  >
                                    <img
                                      src={card.frontSrc}
                                      alt={card.title}
                                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                                      draggable={false}
                                    />
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
                                    {getCardTitleText(card.title)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );

                  if (submittedActiveUser && filtered.length === 0) {
                    return (
                      <div style={{ fontWeight: 900, color: "#64748b" }}>（{submittedActiveUser}の提出結果がありません）</div>
                    );
                  }

                  return (
                    <div style={{ display: "grid", gap: 14 }}>
                      {filtered.map((u) => (
                        <div
                          key={`submitted-${u.userName}`}
                          style={{ borderRadius: 16, border: "2px solid rgba(15,23,42,0.12)", padding: 12 }}
                        >
                          <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>{u.userName}</div>
                          <div style={{ display: "grid", gap: 10 }}>
                            {renderRow(u, "行きたい", u.want, "#dcfce7")}
                            {renderRow(u, "どちらでもいい", u.neutral, "#fffbeb")}
                            {renderRow(u, "行きたくない", u.dont, "#fee2e2")}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()
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
            overflowY: "auto",
            overscrollBehavior: "contain",
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
            <div style={{ fontWeight: 900, fontSize: 20, color: "#0f172a" }}>VSのカードを ぎろんしましょう</div>
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
