"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
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
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { listenToPresence } from "../../../../../lib/firebase-utils-safe";
import {
  agreementForCard,
  agreementOverall,
  convertSelectionsToMatrix,
} from "../../../../utils/agreement-calculator";
import { normalizeCategories } from "../../../../utils/normalizeCategories";

const PLAY3_VOTE_COLLECTION = "play3Votes";

type VoteChoice = "go" | "no" | "pending";
type ActiveVoteState = {
  cardId: string;
  sessionId: string;
  modalOpen: boolean;
  initiatedById?: string;
  initiatedByName?: string;
  round: number;
  expectedUserIds?: string[];
};

export default function Play3Page() {
  const params = useParams();
  const roomId = Array.isArray((params as any).roomId)
    ? (params as any).roomId[0]
    : (params as any).roomId;
  const router = useRouter();
  const { userName } = useUser();
  const normalizedUserName = useMemo(
    () => (userName ? userName.trim() : ""),
    [userName]
  );
  usePreventBack();

  // 画面が狭い場合に全体を少し縮小して表示
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => {
      const h = window.innerHeight || 0;
      setScale(h < 900 ? 0.85 : 1);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // カード定義（40枚）
  const ALL_CARDS = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const idx = i + 1;
        return {
          id: `card${idx}`,
          title: `カード${idx}`,
          src: `/pngs/USJ_${idx}_surface-1.png`,
          backSrc: `/pngs/back/USJ_${idx}_back-1.png`,
        };
      }),
    []
  );

  type CatItem = { id: string; reason?: string };
  type Selections = {
    user: string;
    userId: string;
    userName: string;
    planName?: string;
    categories: {
      veryWant: CatItem[];
      want: CatItem[];
      neutral: CatItem[];
      dont: CatItem[];
      veryDont: CatItem[];
    };
  }[];

  const [selections, setSelections] = useState<Selections>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [overallAgreement, setOverallAgreement] = useState(0);
  const [agreementMap, setAgreementMap] = useState<Map<string, number>>(
    new Map()
  );
  // 入室中ユーザー（RTDB presence）
  const [presentIds, setPresentIds] = useState<string[]>([]);

  // 共有配置（Firestore: rooms/{roomId}/play3Assignments/{cardId} => { status: 'go'|'no'|'vs'|'neutral', pending?: boolean }）
  const [goIds, setGoIds] = useState<string[]>([]);
  const [noIds, setNoIds] = useState<string[]>([]);
  const [vsIds, setVsIds] = useState<string[]>([]);
  const [neutralIds, setNeutralIds] = useState<string[]>([]);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [blackBorderIds, setBlackBorderIds] = useState<Set<string>>(new Set());
  const [assignLoaded, setAssignLoaded] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 参加者（右上アバター用）
  const [activeUserInfo, setActiveUserInfo] = useState<string | null>(null);
  const [userInfoExpanded, setUserInfoExpanded] = useState<
    Record<string, boolean>
  >({});

  // ルームに保存された参加者（id→name の辞書を rooms/{roomId} に持つ想定）
  const [roomParticipants, setRoomParticipants] = useState<
    { id: string; name: string }[]
  >([]);
  const [sessionParticipantId, setSessionParticipantId] = useState<string | null>(
    null
  );
  const [localUserId, setLocalUserId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem("hok3:participantId");
      if (stored) setSessionParticipantId(stored);
    } catch {}
  }, []);

  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) {
        setRoomParticipants([]);
        return;
      }
      const data: any = snap.data();
      const parts = data?.participants || {};
      const list = Object.entries(parts).map(([id, name]) => ({
        id,
        name: typeof name === "string" && name.trim().length > 0 ? name.trim() : id,
      }));
      setRoomParticipants(list);
      if (typeof window !== "undefined" && normalizedUserName) {
        const match = list.find((p) => p.name === normalizedUserName);
        if (match) {
          try {
            window.sessionStorage.setItem("hok3:participantId", match.id);
          } catch {}
          setSessionParticipantId(match.id);
        }
      }
    });
    return () => unsub();
  }, [roomId, normalizedUserName]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storageKey = "hok3:localUserId";
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (stored && stored.trim().length > 0) {
        setLocalUserId(stored.trim());
        return;
      }
      const randomId =
        typeof window.crypto !== "undefined" &&
        typeof window.crypto.randomUUID === "function"
          ? window.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const generated = `local-${randomId}`;
      window.sessionStorage.setItem(storageKey, generated);
      setLocalUserId(generated);
    } catch {
      const fallback = `local-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      setLocalUserId(fallback);
    }
  }, []);

  // presence を優先して参加者を決定（未取得時は selections をフォールバック）
  const participants = useMemo(() => {
    const map = new Map<string, { id: string; name: string; plan: string }>();

    const ensure = (
      rawId?: string | null,
      nameHint?: string | null,
      planHint?: string | null
    ) => {
      const trimmedId = rawId?.trim();
      if (!trimmedId) return null;
      const resolvedName = nameHint?.trim();
      const resolvedPlan = planHint || "";
      const existing = map.get(trimmedId);
      if (existing) {
        let nextName = existing.name;
        let nextPlan = existing.plan;
        if (
          resolvedName &&
          (existing.name === existing.id || existing.name.trim().length === 0)
        ) {
          nextName = resolvedName;
        }
        if (!nextPlan && resolvedPlan) {
          nextPlan = resolvedPlan;
        }
        if (nextName !== existing.name || nextPlan !== existing.plan) {
          map.set(trimmedId, { id: trimmedId, name: nextName, plan: nextPlan });
        }
        return trimmedId;
      }
      map.set(trimmedId, {
        id: trimmedId,
        name: resolvedName || trimmedId,
        plan: resolvedPlan
      });
      return trimmedId;
    };

    const resolveFromAny = (raw?: string | null, planHint?: string | null) => {
      const trimmed = raw?.trim();
      if (!trimmed) return null;
      if (map.has(trimmed)) return trimmed;

      const roomMatch = roomParticipants.find(
        (p) => p.id === trimmed || p.name === trimmed
      );
      if (roomMatch) {
        return ensure(roomMatch.id, roomMatch.name, planHint);
      }

      const selectionMatch = selections.find(
        (s) =>
          s.userId === trimmed ||
          s.user === trimmed ||
          s.userName === trimmed
      );
      if (selectionMatch) {
        const id = selectionMatch.userId || selectionMatch.user || trimmed;
        const name =
          selectionMatch.userName ||
          selectionMatch.user ||
          selectionMatch.userId ||
          trimmed;
        return ensure(id, name, selectionMatch.planName || planHint);
      }

      return ensure(trimmed, trimmed, planHint);
    };

    roomParticipants.forEach((p) => {
      resolveFromAny(p.id, "");
    });

    selections.forEach((s) => {
      resolveFromAny(s.userId || s.user, s.planName || "");
    });

    if (sessionParticipantId) {
      ensure(
        sessionParticipantId,
        normalizedUserName || userName || sessionParticipantId,
        ""
      );
    } else if (localUserId) {
      ensure(localUserId, normalizedUserName || userName || localUserId, "");
    }

    const presentSet = new Set<string>();
    presentIds.forEach((pid) => {
      const resolved = resolveFromAny(pid);
      if (resolved) {
        presentSet.add(resolved);
      }
    });
    if (presentSet.size > 0) {
      return Array.from(presentSet)
        .map((id) => map.get(id) || { id, name: id, plan: "" })
        .filter(
          (p, index, arr) =>
            arr.findIndex((candidate) => candidate.id === p.id) === index
        );
    }

    return Array.from(map.values());
  }, [
    presentIds,
    selections,
    roomParticipants,
    sessionParticipantId,
    normalizedUserName,
    userName,
    localUserId,
  ]);


  // ===== 全員投票モード =====
  const [activeVote, setActiveVote] = useState<ActiveVoteState | null>(null);
  const [voteMap, setVoteMap] = useState<Record<string, VoteChoice>>({});
  const [myVoteChoice, setMyVoteChoice] = useState<VoteChoice | null>(null);

  const totalParticipants = resolvedParticipantIds.length;
  const myUserId = useMemo(() => {
    const trimmedSession = sessionParticipantId?.trim();
    if (trimmedSession) return trimmedSession;
    if (normalizedUserName) {
      const matchByName = participants.find(
        (p) => p.name === normalizedUserName
      );
      if (matchByName?.id) return matchByName.id.trim();
      const matchRoom = roomParticipants.find(
        (p) => p.name === normalizedUserName
      );
      if (matchRoom?.id) return matchRoom.id.trim();
      const selectionMatch = selections.find(
        (s) => s.userName === normalizedUserName || s.user === normalizedUserName
      );
      if (selectionMatch?.userId) return selectionMatch.userId.trim();
    }
    if (userName && userName.trim().length > 0) {
      return userName.trim();
    }
    if (localUserId && localUserId.trim().length > 0) {
      return localUserId.trim();
    }
    return "";
  }, [
    sessionParticipantId,
    normalizedUserName,
    participants,
    roomParticipants,
    selections,
    userName,
    localUserId,
  ]);

  const displayParticipants = useMemo(() => {
    // 重複除去と有効な参加者のみフィルタリング
    const validParticipants = participants.filter((p) =>
      p.id && p.id.trim() && p.name && p.name.trim()
    );

    // 自分が含まれているかチェック
    const selfIncluded = myUserId && validParticipants.some((p) => p.id === myUserId);

    if (selfIncluded) {
      return validParticipants;
    }

    // 自分が含まれていない場合は追加
    if (myUserId && normalizedUserName) {
      return [
        ...validParticipants,
        { id: myUserId, name: normalizedUserName, plan: "" },
      ];
    }

    return validParticipants;
  }, [participants, myUserId, normalizedUserName]);

  // 実参加者リスト（重複・未定義を除去、自分も含める）
  const resolvedParticipantIds = useMemo(() => {
    const appendSelf = (ids: string[]) => {
      const trimmedSelf = myUserId?.trim();
      if (trimmedSelf && !ids.includes(trimmedSelf)) {
        return [...ids, trimmedSelf];
      }
      return ids;
    };

    const byDisplay = displayParticipants
      .map((p) => p.id?.trim())
      .filter((id): id is string => !!id);

    if (byDisplay.length > 0) {
      return Array.from(new Set(appendSelf(byDisplay)));
    }

    const byPresence = presentIds
      .map((pid) => pid?.trim())
      .filter((pid): pid is string => !!pid);

    if (byPresence.length > 0) {
      return Array.from(new Set(appendSelf(byPresence)));
    }

    const bySelections = selections
      .map((s) => s.userId || s.user)
      .map((id) => id?.trim())
      .filter((id): id is string => !!id);

    if (bySelections.length > 0) {
      return Array.from(new Set(appendSelf(bySelections)));
    }

    return appendSelf([] as string[]);
  }, [displayParticipants, presentIds, selections, myUserId]);

  // expectedVoteIds は displayParticipants を真実源とする（投票分母）
  const expectedVoteIds = useMemo(() => {
    const ids = displayParticipants.map((p) => p.id?.trim()).filter(Boolean);
    const seen = new Set<string>();
    return ids.filter((id) => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [displayParticipants]);


  const participantMap = useMemo(
    () => new Map(displayParticipants.map((p) => [p.id, p] as const)),
    [displayParticipants]
  );

  const initiatorDisplayName = useMemo(() => {
    if (!activeVote) return "";
    if (activeVote.initiatedById) {
      const found = participantMap.get(activeVote.initiatedById);
      if (found?.name) return found.name;
    }
    if (activeVote.initiatedByName) return activeVote.initiatedByName;
    return "";
  }, [activeVote, participantMap]);

  const voteAvatarBaseStyle = {
    width: 32,
    height: 32,
    borderRadius: "50%",
    border: "1px solid #e2e8f0",
    background: "#fff",
    boxShadow: "0 2px 8px rgba(15,23,42,0.12)",
    fontWeight: 800,
    fontSize: 13,
    color: "#111827",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  } as const;

  // ボタン付属の投票アイコン：参加者人数ぶんで完結（最大4個）。超過は「+n」バッジで集約
  const renderVoteAvatars = (target: VoteChoice) => {
    // 表示順は実参加者順に固定（ゴーストID回避 & UIの一貫性）
    const ordered = displayParticipants.map((p) => p.id);
    const voters = ordered.filter((id) => {
      const server = voteMap[id];
      const mine = id === myUserId ? (myVoteChoice ?? server) : server;
      return mine === target;
    });
    
    // デバッグログ追加
    console.log(`renderVoteAvatars(${target}):`, {
      displayParticipants: displayParticipants.map(p => ({ id: p.id, name: p.name })),
      voteMap,
      myUserId,
      myVoteChoice,
      ordered,
      voters,
      target
    });
    
    if (voters.length === 0) return null;

    const maxIcons = Math.min(displayParticipants.length, 4);
    const show = voters.slice(0, maxIcons);
    const rest = voters.length - show.length;

    const nodes: React.ReactNode[] = [];
    show.forEach((id, idx) => {
      const info = participantMap.get(id);
      const style: React.CSSProperties = {
        ...voteAvatarBaseStyle,
        marginLeft: idx ? -12 : 0,
      };
      nodes.push(
        <div key={`${target}-${id}`} title={info?.name || id} style={style}>
          {info?.name?.[0]?.toUpperCase() || id?.[0]?.toUpperCase() || "?"}
        </div>
      );
    });
    if (rest > 0) {
      nodes.push(
        <div
          key={`${target}-more`}
          title={`+${rest}`}
          style={{ ...voteAvatarBaseStyle, marginLeft: -12, fontSize: 11 }}
        >
          +{rest}
        </div>
      );
    }
    return nodes;
  };

  // 移行（結果へ）準備状況
  const [play3Ready, setPlay3Ready] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qReady = query(collection(db, "rooms", roomId, "play3Ready"));
    const unsub = onSnapshot(qReady, (snap) => {
      const map: Record<string, boolean> = {};
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.ready) map[data.userId || d.id] = true;
      });
      setPlay3Ready(map);
    });
    return () => unsub();
  }, [roomId]);

  // 全員準備完了で自動遷移
  useEffect(() => {
// ✅ displayParticipants ベースで準備完了判定
useEffect(() => {
  const actualParticipantCount = displayParticipants.length;
  const readyCount = displayParticipants.reduce((acc, participant) => {
    return acc + (play3Ready[participant.id] ? 1 : 0);
  }, 0);

  if (actualParticipantCount > 0 && readyCount === actualParticipantCount && vsIds.length === 0) {
    router.push(`/room/${roomId}/result`);
  }
}, [play3Ready, displayParticipants, vsIds.length, router, roomId]);


  // finalSelections 購読
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qSel = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsub = onSnapshot(qSel, (snap) => {
      const list: Selections = [] as any;
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const norm = normalizeCategories(data.categories || {});
        list.push({
          user: data.user || data.userId || data.userName || d.id,
          userId: data.userId || data.user || data.userName || d.id,
          userName: data.userName || data.user || data.userId || d.id,
          planName: data.planName || data.planname || "",
          categories: {
            veryWant: (norm.verywant || []).map((c: any) => ({
              id: c.id,
              reason: c.reason,
            })),
            want: (norm.want || []).map((c: any) => ({ id: c.id })),
            neutral: (norm.neutral || []).map((c: any) => ({ id: c.id })),
            dont: (norm.dont || []).map((c: any) => ({ id: c.id })),
            veryDont: (norm.verydont || []).map((c: any) => ({
              id: c.id,
              reason: c.reason,
            })),
          },
        });
      });
      setSelections(list);
      setIsLoading(false);
    });
    return () => unsub();
  }, [roomId]);

  // 合致率計算（全体・カード別）
  useEffect(() => {
    if (!selections.length) return;
    const matrix = convertSelectionsToMatrix(selections as any, 40);
    setOverallAgreement(agreementOverall(matrix));
    const map = new Map<string, number>();
    matrix.forEach((ratings, idx) => {
      map.set(`card${idx + 1}`, agreementForCard(ratings));
    });
    setAgreementMap(map);
  }, [selections]);

  // presence 購読（入室中ユーザーだけを分母に）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    let unsub: (() => void) | undefined;
    (async () => {
      unsub = await listenToPresence(roomId as string, (presence) => {
        try {
          const onlineIds = Object.entries(presence || {})
            .filter(([, v]: any) => v && v.online)
            .map(([id]) => id);
          setPresentIds(onlineIds);
        } catch {
          setPresentIds([]);
        }
      });
    })();
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, [roomId]);

  // play3Assignments 購読
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qAssign = query(collection(db, "rooms", roomId, "play3Assignments"));
    const unsub = onSnapshot(qAssign, (snap) => {
      if (snap.empty) {
        setAssignLoaded(true);
        return;
      }
      const go: string[] = [];
      const no: string[] = [];
      const vs: string[] = [];
      const neu: string[] = [];
      const pending: Set<string> = new Set();
      const blackBorder: Set<string> = new Set();
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.status === "go") go.push(d.id);
        else if (data?.status === "no") no.push(d.id);
        else if (data?.status === "vs") vs.push(d.id);
        else if (data?.status === "neutral") neu.push(d.id);
        if (data?.pending) pending.add(d.id);
        if (data?.hasBlackBorder) blackBorder.add(d.id);
      });
      setGoIds(go);
      setNoIds(no);
      setVsIds(vs);
      setNeutralIds(neu);
      setPendingIds(pending);
      setBlackBorderIds(blackBorder);
      setAssignLoaded(true);
    });
    return () => unsub();
  }, [roomId]);

  // 初期自動配置（一度だけ・play3Assignments が空のとき）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    if (!assignLoaded || initialized) return;
    if (!selections.length) return;
    // snapshot で空（assignLoaded true かつ go/no/vs/neutral 全て空）なら初期化
    const empty =
      goIds.length + noIds.length + vsIds.length + neutralIds.length === 0;
    if (!empty) {
      setInitialized(true);
      return;
    }

    const byCard = (id: string) =>
      selections.map((s) => ({
        pos:
          s.categories.veryWant.some((c) => c.id === id) ||
          s.categories.want.some((c) => c.id === id),
        posStrong: s.categories.veryWant.some((c) => c.id === id),
        posReason:
          (s.categories.veryWant.find((c) => c.id === id)?.reason || "").trim()
            .length > 0,
        neg:
          s.categories.dont.some((c) => c.id === id) ||
          s.categories.veryDont.some((c) => c.id === id),
        negStrong: s.categories.veryDont.some((c) => c.id === id),
        negReason:
          (s.categories.veryDont.find((c) => c.id === id)?.reason || "").trim()
            .length > 0,
        neu: s.categories.neutral.some((c) => c.id === id),
      }));

    const initWrites = async () => {
      for (const card of ALL_CARDS) {
        const arr = byCard(card.id);
        const pos = arr.some((a) => a.pos);
        const neg = arr.some((a) => a.neg);
        const allNeutral = arr.length > 0 && arr.every((a) => a.neu);
        const hasNeutral = arr.some((a) => a.neu);
        const hasReason = arr.some((a) => a.posReason || a.negReason);
        let status: "go" | "no" | "vs" | "neutral" = "neutral";
        if (pos && !neg && !allNeutral) status = "go";
        else if (neg && !pos && !allNeutral) status = "no";
        else if (pos && neg) status = "vs";
        else if (allNeutral) status = "neutral";
        else if ((pos && hasNeutral) || (neg && hasNeutral))
          status = hasReason ? "vs" : "vs";
        else status = "neutral";
        await setDoc(
          doc(db, "rooms", roomId, "play3Assignments", card.id),
          {
            status,
            pending: status === "vs",
            updatedAt: serverTimestamp(),
            updatedBy: userName || "system",
          },
          { merge: true }
        );
      }
      setInitialized(true);
    };
    initWrites();
  }, [
    assignLoaded,
    initialized,
    selections,
    roomId,
    userName,
    goIds.length,
    noIds.length,
    vsIds.length,
    neutralIds.length,
  ]);

  // 並び順: 合致率 降順
  const sortByAgreement = useCallback(
    (ids: string[]) => {
      return [...ids].sort(
        (a, b) => (agreementMap.get(b) || 0) - (agreementMap.get(a) || 0)
      );
    },
    [agreementMap]
  );

  // UI: 参加者アイコン（頭文字）
  const renderAvatars = () => {
    const seen = new Set<string>();
    const resolvedSet = new Set(resolvedParticipantIds);

    const actualParticipants = displayParticipants.filter((p) => {
      const id = (p.id || "").trim();
      const name = (p.name || "").trim();
      if (!id || !name || seen.has(id)) return false;
      if (resolvedSet.size > 0 && !resolvedSet.has(id)) return false;

      seen.add(id);
      return true;
    });

// 全参加者分のアイコンを表示（投票中は投票状況を反映）
const isVotingActive = activeVote?.modalOpen;

return (
  <div style={{ display: "flex", gap: 8 }}>
    {actualParticipants.map((p) => {
      // 投票状況をチェック
      const hasVoted = isVotingActive ? !!(voteMap[p.id] || (p.id === myUserId && myVoteChoice)) : false;
      const isUnvoted = isVotingActive && !hasVoted;

      return (
        <button
          key={p.id}
          onClick={() => setActiveUserInfo(p.id)}
          title={`${p.name} (${p.id}) ${isVotingActive ? (hasVoted ? "投票済み" : "未投票") : ""}`}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "1px solid #e5e7eb",
            background: isUnvoted ? "#4b5563" : "#fff", // 未投票者は黒塗り
            boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
            fontWeight: 800,
            color: isUnvoted ? "#fff" : "#111827", // 未投票者は白文字
            cursor: "pointer",
          }}
        >
          {p.name?.[0]?.toUpperCase() || "?"}
        </button>
      );
    })}
  </div>
);

      </div>
    );
  };

  const getCard = (id: string) => ALL_CARDS.find((c) => c.id === id);

  // カードモーダル
  const [cardModal, setCardModal] = useState<{ id: string; flipped: boolean } | null>(null);
  const openCard = (id: string) => setCardModal({ id, flipped: false });
  const closeCard = () => setCardModal(null);
  const [uiLocked, setUiLocked] = useState(false);
  const [uiLockReason, setUiLockReason] = useState<null | "vote" | "migrate">(null);

  const classify = async (
    id: string,
    status: "go" | "no" | "vs" | "neutral",
    pending?: boolean
  ) => {
    if (!roomId || typeof roomId !== "string") return;
    if (uiLocked) return; // ロック中は操作不可
    await setDoc(
      doc(db, "rooms", roomId, "play3Assignments", id),
      {
        status,
        pending: !!pending,
        updatedAt: serverTimestamp(),
        updatedBy: userName || "unknown",
      },
      { merge: true }
    );
    closeCard();
  };

  const CHOICE_TO_CODE: Record<VoteChoice, 0 | 1 | 2> = {
    go: 1,
    no: 0,
    pending: 2,
  };
  const CODE_TO_CHOICE: Record<0 | 1 | 2, VoteChoice> = {
    0: "no",
    1: "go",
    2: "pending",
  };
  const formatVoteValue = (round: number, choice: VoteChoice) =>
    `y${round}-${CHOICE_TO_CODE[choice]}`;
  const parseVoteValue = (value: unknown):
    | { round: number; choice: VoteChoice }
    | null => {
    if (typeof value !== "string") return null;
    const match = value.match(/^y(\d+)-([0-2])$/);
    if (!match) return null;
    const round = Number(match[1]);
    const code = Number(match[2]) as 0 | 1 | 2;
    const choice = CODE_TO_CHOICE[code];
    if (!choice || Number.isNaN(round)) return null;
    return { round, choice };
  };

  // 状態購読（全員へモーダル同期）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const unsub = onSnapshot(doc(db, "rooms", roomId, "play3State", "state"), (snap) => {
      const data: any = snap.data();
      if (data) {
        const next: ActiveVoteState = {
          cardId: data.cardId || "",
          sessionId: data.sessionId || "",
          modalOpen: !!data.modalOpen,
          initiatedById: data.initiatedById || data.initiatedBy,
          initiatedByName: data.initiatedByName || data.initiatedBy,
          round: typeof data.round === "number" ? data.round : 0,
          expectedUserIds: Array.isArray(data.expectedUserIds)
            ? (data.expectedUserIds as string[])
            : undefined,
        };
        setActiveVote(next);
        if (next.modalOpen && next.cardId) {
          setCardModal((m) => (m?.id === next.cardId ? m : { id: next.cardId, flipped: false }));
        }
      } else {
        setActiveVote(null);
      }
    });
    return () => unsub();
  }, [roomId]);

  // 投票状況購読（モーダル表示中のみ）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const cid = activeVote?.cardId;
    if (!cid || !activeVote?.modalOpen) {
      setVoteMap({});
      setMyVoteChoice(null);
      return;
    }
    const nameToId = new Map<string, string>(
      displayParticipants.map((p) => [p.name, p.id])
    );
    const validIds = new Set(displayParticipants.map((p) => p.id));
    const resolvedSet = new Set(resolvedParticipantIds);
    const unsub = onSnapshot(
      doc(db, "rooms", roomId, PLAY3_VOTE_COLLECTION, cid),
      (snap) => {
        const data: any = snap.data();
        if (!data || data.sessionId !== activeVote.sessionId) {
          setVoteMap({});
          setMyVoteChoice(null);
          return;
        }
        const docRound =
          typeof data.currentRound === "number" ? data.currentRound : 0;
        const raw = data?.votes || {};
        const normalized: Record<string, VoteChoice> = {};
        const allowUnknown =
          validIds.size === 0 && resolvedSet.size === 0;
        Object.entries(raw).forEach(([k, v]) => {
          const parsed = parseVoteValue(v);
          if (!parsed) return;
          if (docRound > 0 && parsed.round !== docRound) return;
          const trimmed = typeof k === "string" ? k.trim() : "";
          if (!trimmed) return;

          let key = trimmed;
          if (validIds.has(trimmed)) {
            key = trimmed;
          } else if (nameToId.has(trimmed)) {
            key = nameToId.get(trimmed)!;
          } else {
            // IDズレ対策: displayParticipantsに含まれないuserIdの投票は除外
            console.log(`投票を除外: ${trimmed} (参加者リストに存在しない)`);
            return;
          }

          // 最終的にvalidIdsに含まれるキーのみ投票として認める
          if (validIds.has(key)) {
            normalized[key] = parsed.choice;
          } else {
            console.log(`投票を除外: ${key} (正規化後も参加者リストに存在しない)`);
          }

          }
        });
        const myServerChoice = normalized[myUserId];
        setVoteMap(() => {
          const merged: Record<string, VoteChoice> = { ...normalized };
          if (
            !myServerChoice &&
            myUserId &&
            myVoteChoice &&
            (!activeVote.round || docRound === activeVote.round)
          ) {
            merged[myUserId] = myVoteChoice;
          }
          return merged;
        });
        if (myServerChoice) {
          setMyVoteChoice(myServerChoice);
        }
      }
    );
    return () => unsub();
  }, [
    roomId,
    activeVote?.cardId,
    activeVote?.sessionId,
    activeVote?.modalOpen,
    activeVote?.round,
    displayParticipants,
    resolvedParticipantIds,
    myUserId,
    myVoteChoice,
  ]);

  // 全員投票完了で自動判定・クローズ（participants ベースで集計）
  useEffect(() => {
    if (!activeVote?.modalOpen) return;
    const expectedIds = displayParticipants.map(p => p.id);
    const total = expectedIds.length;
    if (total <= 0 || !activeVote.cardId) return;

    const byId: Record<string, VoteChoice> = {};
    for (const id of expectedIds) {
      const v = voteMap[id];
      if (v) byId[id] = v;
    }
    if (myUserId && myVoteChoice && expectedIds.includes(myUserId) && !byId[myUserId]) {
      byId[myUserId] = myVoteChoice;
    }

    const voted = Object.keys(byId).length;
    console.log('Vote completion check:', { voted, total, byId, expectedIds });
    
    if (voted >= total) {
      const votes = Object.values(byId);
      const allGo = votes.every((v) => v === "go");
      const allNo = votes.every((v) => v === "no");

      (async () => {
        const goVotes = votes.filter((v) => v === "go").length;
        const noVotes = votes.filter((v) => v === "no").length;
        const pendingVotes = votes.filter((v) => v === "pending").length;

        if (allGo) {
          await setDoc(
            doc(db, "rooms", roomId!, "play3Assignments", activeVote.cardId),
            {
              status: "go",
              pending: false,
              updatedAt: serverTimestamp(),
              updatedBy: userName || "unknown",
              voteResult: { go: goVotes, no: noVotes, pending: pendingVotes },
              hasBlackBorder: false,
            },
            { merge: true }
          );
        } else if (allNo) {
          await setDoc(
            doc(db, "rooms", roomId!, "play3Assignments", activeVote.cardId),
            {
              status: "no",
              pending: false,
              updatedAt: serverTimestamp(),
              updatedBy: userName || "unknown",
              voteResult: { go: goVotes, no: noVotes, pending: pendingVotes },
              hasBlackBorder: false,
            },
            { merge: true }
          );
        } else if (votes.every((v) => v === "pending")) {
          await setDoc(
            doc(db, "rooms", roomId!, "play3Assignments", activeVote.cardId),
            {
              status: "vs",
              pending: true,
              updatedAt: serverTimestamp(),
              updatedBy: userName || "unknown",
              voteResult: { go: goVotes, no: noVotes, pending: pendingVotes },
              hasBlackBorder: true,
            },
            { merge: true }
          );
        } else {
          await setDoc(
            doc(db, "rooms", roomId!, "play3Assignments", activeVote.cardId),
            {
              status: "vs",
              pending: true,
              updatedAt: serverTimestamp(),
              updatedBy: userName || "unknown",
              voteResult: { go: goVotes, no: noVotes, pending: pendingVotes },
              hasBlackBorder: true,
            },
            { merge: true }
          );
        }

        // 投票状態をクリア
        await setDoc(
          doc(db, "rooms", roomId!, "play3State", "state"),
          {
            cardId: null,
            modalOpen: false,
            sessionId: null,
            initiatedBy: null,
            initiatedById: null,
            initiatedByName: null,
            round: null,
            expectedUserIds: [],
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        setUiLocked(false);
        setUiLockReason(null);
        setMyVoteChoice(null);
        setVoteMap({});
        closeCard();
      })();
    }
  }, [
    activeVote?.modalOpen,
    activeVote?.cardId,
    activeVote?.round,
    activeVote?.sessionId,
    voteMap,
    displayParticipants, // expectedVoteIdsから変更
    myVoteChoice,
    roomId,
    myUserId,
    userName,
  ]);

  // 実参加者に含まれないIDでは投票を開始できないようにする
  const isActualParticipant = useMemo(() => {
    return !!(myUserId && displayParticipants.some(p => p.id === myUserId));
  }, [myUserId, displayParticipants]);

  const startVote = async (choice: VoteChoice, targetCardId?: string) => {
    const effectiveUserId = myUserId?.trim();
    if (!roomId || typeof roomId !== "string" || !effectiveUserId) return;
    if (!isActualParticipant) {
      alert(
        "この端末のIDが部屋の参加者として認識されていません。\n右上の参加者名と一致する端末から投票してください。"
      );
      return;
    }

    const cid = targetCardId || cardModal?.id;
    if (!cid) return;
    const sessionId = `${cid}-${Date.now()}`;
    const cardRef = doc(db, "rooms", roomId, PLAY3_VOTE_COLLECTION, cid);
    let nextRound = 1;
    let history: Record<string, Record<string, string>> = {};
    try {
      const snap = await getDoc(cardRef);
      if (snap.exists()) {
        const data: any = snap.data();
        const prevRound = typeof data.currentRound === "number" ? data.currentRound : 0;
        const prevVotes: Record<string, string> = (data?.votes || {}) as any;
        const prevHistory: Record<string, Record<string, string>> =
          (data?.history as Record<string, Record<string, string>>) || {};
        history = { ...prevHistory };
        if (prevRound > 0 && Object.keys(prevVotes || {}).length > 0) {
          const key = `y${prevRound}`;
          history[key] = { ...(history[key] || {}), ...prevVotes };
        }
        nextRound = prevRound > 0 ? prevRound + 1 : 1;
      }
    } catch (error) {
      console.warn("Failed to load existing play3Votes doc", error);
    }
    // 分母は常に実参加者（表示中の参加者）
    const participantIds = Array.from(
      new Set(
        displayParticipants
          .map((p) => p.id?.trim())
          .filter((id): id is string => !!id && id.length > 0)
      )
    );

    // 自分が含まれていない場合は追加（安全策）
    const trimmedSelf = effectiveUserId?.trim();
    if (trimmedSelf && !participantIds.includes(trimmedSelf)) {
      participantIds.push(trimmedSelf);
    }

    const myKey = effectiveUserId;
    const voteValue = formatVoteValue(nextRound, choice);
    await setDoc(
      cardRef,
      {
        cardId: cid,
        sessionId,
        currentRound: nextRound,
        votes: { [myKey]: voteValue },
        history,
        expectedUserIds: participantIds, // ← 実参加者に固定
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await setDoc(
      doc(db, "rooms", roomId, "play3State", "state"),
      {
        cardId: cid,
        modalOpen: true,
        sessionId,
        initiatedBy: normalizedUserName || userName || myUserId,
        initiatedById: myUserId,
        initiatedByName: normalizedUserName || userName || myUserId,
        round: nextRound,
        expectedUserIds: participantIds, // ← 実参加者に固定
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    setUiLocked(true); // 最初に押した人はロック
    setUiLockReason("vote");
    setMyVoteChoice(choice);
    // 押した瞬間に自分の投票アイコンを出す（楽観更新）
    try {
      setVoteMap((prev) => ({
        ...prev,
        [effectiveUserId]: choice,
      }));
    } catch {}
  };

  const castVote = async (choice: VoteChoice) => {
    if (
      !roomId ||
      typeof roomId !== "string" ||
      !activeVote?.cardId ||
      !activeVote?.sessionId ||
      !myUserId
    )
      return;
    if (!isActualParticipant) {
      alert("この端末のIDが部屋の参加者として認識されていません。右上の参加者名と一致する端末から投票してください。");
      return;
    }
    // 押した瞬間に自分の投票アイコンを出す（楽観更新）
    try {
      setMyVoteChoice(choice);
      setVoteMap((prev) => ({
        ...prev,
        [myUserId]: choice,
      }));
    } catch {}
    const myKey = myUserId;
    const round = activeVote.round > 0 ? activeVote.round : 1;
    const voteValue = formatVoteValue(round, choice);
    await setDoc(
      doc(db, "rooms", roomId, PLAY3_VOTE_COLLECTION, activeVote.cardId),
      {
        sessionId: activeVote.sessionId,
        currentRound: round,
        updatedAt: serverTimestamp(),
        [`votes.${myKey}`]: voteValue,
      } as any,
      { merge: true }
    );
  };

  // Neutral 折りたたみ
  const [neutralOpen, setNeutralOpen] = useState(false);

  if (isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        読み込み中...
      </div>
    );
  }

  // 整列済み ID
  const goSorted = sortByAgreement(goIds);
  const noSorted = sortByAgreement(noIds);
  const vsSorted = sortByAgreement(vsIds);
  const neuSorted = sortByAgreement(neutralIds);

  // 縮小時はカード幅も少し小さく
  const TILE_W = scale < 1 ? 180 : 220;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fff",
        overflowX: "hidden",
        cursor: uiLocked && uiLockReason === "vote" ? "progress" : "default",
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top center",
          width: "100%",
          margin: "0 auto",
          boxSizing: "border-box",
        }}
      >
        {/* ヘッダー行 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid #e5e7eb",
          }}
        >
          <div style={{ fontWeight: 900, color: "#111827" }}>
            合致率 {overallAgreement.toFixed(0)}%
          </div>
          {renderAvatars()}
        </div>

        {/* 開始メッセージ */}
        <div
          style={{
            padding: "10px 16px",
            background: "#fffbeb",
            borderBottom: "1px solid #fde68a",
            color: "#92400e",
            fontWeight: 700,
          }}
        >
          投票しましょう！
        </div>

        {/* 上段: 行く / 行かない */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: 12,
            padding: 12,
          }}
        >
          {/* 行く */}
          <section
            style={{
              minWidth: 0,
              background: "#fee2e2",
              border: "2px solid #fca5a5",
              borderRadius: 12,
              padding: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 900, color: "#7f1d1d" }}>行く</div>
              <div style={{ color: "#7f1d1d", fontWeight: 700 }}>
                {goSorted.length}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: 4,
                flexWrap: "nowrap",
              }}
            >
              {goSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                return (
                  <div
                    key={id}
                    onClick={() => openCard(id)}
                    style={{
                      cursor: "pointer",
                      width: TILE_W,
                      flex: "0 0 auto",
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ width: "100%", aspectRatio: "3/2", background: "#fff" }}>
                      <img
                        src={info?.src}
                        alt={info?.title}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    </div>
                    <div
                      style={{
                        padding: "6px 8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 800, color: "#111827", fontSize: 12 }}>
                        {info?.title}
                      </div>
                      <div style={{ fontWeight: 800, color: "#334155", fontSize: 12 }}>
                        {ag.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 行かない */}
          <section
            style={{
              minWidth: 0,
              background: "#1e3a8a",
              border: "2px solid #334155",
              borderRadius: 12,
              padding: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 900, color: "#fff" }}>行かない</div>
              <div style={{ color: "#e2e8f0", fontWeight: 700 }}>
                {noSorted.length}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: 4,
                flexWrap: "nowrap",
              }}
            >
              {noSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                return (
                  <div
                    key={id}
                    onClick={() => openCard(id)}
                    style={{
                      cursor: "pointer",
                      width: TILE_W,
                      flex: "0 0 auto",
                      border: "1px solid #475569",
                      background: "#fff",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ width: "100%", aspectRatio: "3/2", background: "#fff" }}>
                      <img
                        src={info?.src}
                        alt={info?.title}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    </div>
                    <div
                      style={{
                        padding: "6px 8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 800, color: "#111827", fontSize: 12 }}>
                        {info?.title}
                      </div>
                      <div style={{ fontWeight: 800, color: "#334155", fontSize: 12 }}>
                        {ag.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* 中央: 議論中（VS） */}
        <div style={{ padding: "0 12px 12px" }}>
          <section
            style={{
              background: "#ffedd5",
              border: "2px solid #fdba74",
              borderRadius: 12,
              padding: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 900, color: "#9a3412" }}>議論中（VS）</div>
              <div style={{ color: "#9a3412", fontWeight: 700 }}>{vsSorted.length}</div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                overflowX: "auto",
                paddingBottom: 4,
                flexWrap: "nowrap",
              }}
            >
              {vsSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                const hasBlackBorder = blackBorderIds.has(id);
                return (
                  <div
                    key={id}
                    onClick={() => openCard(id)}
                    style={{
                      cursor: "pointer",
                      width: TILE_W,
                      flex: "0 0 auto",
                      border: hasBlackBorder ? "6px solid #000" : "2px solid #e5e7eb",
                      background: "#fff",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ width: "100%", aspectRatio: "3/2", background: "#fff" }}>
                      <img
                        src={info?.src}
                        alt={info?.title}
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    </div>
                    <div
                      style={{
                        padding: "6px 8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 800, color: "#111827", fontSize: 12 }}>
                        {info?.title}
                      </div>
                      <div style={{ fontWeight: 800, color: "#334155", fontSize: 12 }}>
                        {ag.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* 下部: どちらでも（折りたたみ・モーダル表示） */}
        <div style={{ padding: "0 12px 80px" }}>
          <section
            style={{
              background: "#e5e7eb",
              border: "2px solid #d1d5db",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 10,
                cursor: "pointer",
              }}
              onClick={() => setNeutralOpen(true)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 900, color: "#374151" }}>どちらでも</div>
                <div style={{ transform: neutralOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                  ^
                </div>
              </div>
              <div style={{ color: "#374151", fontWeight: 700 }}>{neuSorted.length}</div>
            </div>
          </section>
        </div>

        {/* どちらでも一覧モーダル */}
        {neutralOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 110,
            }}
            onClick={() => setNeutralOpen(false)}
          >
            <div
              style={{
                width: "min(92vw, 960px)",
                maxHeight: "80vh",
                background: "#fff",
                borderRadius: 12,
                padding: 16,
                boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
                overflow: "auto",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 18, color: "#111827" }}>
                  どちらでも（{neuSorted.length}）
                </div>
                <button
                  onClick={() => setNeutralOpen(false)}
                  style={{
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontWeight: 800,
                  }}
                >
                  閉じる
                </button>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {neuSorted.map((id) => {
                  const info = getCard(id);
                  const ag = agreementMap.get(id) || 0;
                  return (
                    <div
                      key={id}
                      onClick={() => {
                        setNeutralOpen(false);
                        openCard(id);
                      }}
                      style={{
                        cursor: "pointer",
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        borderRadius: 12,
                        overflow: "hidden",
                      }}
                    >
                      <div style={{ width: "100%", aspectRatio: "3/2", background: "#fff" }}>
                        <img
                          src={info?.src}
                          alt={info?.title}
                          style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                      </div>
                      <div
                        style={{
                          padding: "6px 8px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div style={{ fontWeight: 800, color: "#111827", fontSize: 12 }}>
                          {info?.title}
                        </div>
                        <div style={{ fontWeight: 800, color: "#334155", fontSize: 12 }}>
                          {ag.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 参加者情報モーダル */}
        {activeUserInfo &&
          (() => {
            const user = selections.find((s) => s.userId === activeUserInfo);
            const counts = user
              ? {
                  veryWant: user.categories.veryWant.length,
                  want: user.categories.want.length,
                  neutral: user.categories.neutral.length,
                  dont: user.categories.dont.length,
                  veryDont: user.categories.veryDont.length,
                }
              : { veryWant: 0, want: 0, neutral: 0, dont: 0, veryDont: 0 };
            const catOrder: Array<{ key: keyof typeof counts; label: string }> = [
              { key: "veryWant", label: "特に行きたい" },
              { key: "want", label: "行きたい" },
              { key: "neutral", label: "どちらでも" },
              { key: "dont", label: "行きたくない" },
              { key: "veryDont", label: "特に行きたくない" },
            ];
            const getList = (k: keyof typeof counts) =>
              user ? user.categories[k] : [];
            return (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 100,
                }}
                onClick={() => setActiveUserInfo(null)}
              >
                <div
                  style={{
                    width: 420,
                    background: "#fff",
                    borderRadius: 12,
                    padding: 16,
                    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
                    border: "1px solid #e5e7eb",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
                    {user?.userName}
                  </div>
                  <div style={{ color: "#374151", marginBottom: 10 }}>
                    プラン名：<strong style={{ color: "#000000" }}>
                      {user?.planName || "—"}
                    </strong>
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {catOrder.map(({ key, label }) => {
                      const expanded = !!userInfoExpanded[key as string];
                      const toggle = () =>
                        setUserInfoExpanded((prev) => ({
                          ...prev,
                          [key as string]: !expanded,
                        }));
                      const list = getList(key);
                      return (
                        <div
                          key={key}
                          style={{ border: "1px solid #e5e7eb", borderRadius: 10 }}
                        >
                          <div
                            onClick={toggle}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "8px 10px",
                              cursor: "pointer",
                            }}
                          >
                            <div>{label}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontWeight: 800 }}>{list.length}</span>
                              <span
                                style={{
                                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                                }}
                              >
                                ^
                              </span>
                            </div>
                          </div>
                          {expanded && (
                            <div
                              style={{
                                padding: "8px 10px",
                                display: "grid",
                                gap: 6,
                              }}
                            >
                              {list.length ? (
                                list.map((c, idx) => {
                                  const info = ALL_CARDS.find((x) => x.id === c.id);
                                  const reason = (c as any).reason || "";
                                  return (
                                    <div
                                      key={idx}
                                      style={{
                                        border: "1px solid #e5e7eb",
                                        borderRadius: 8,
                                        padding: 8,
                                      }}
                                    >
                                      <div
                                        style={{ fontWeight: 700, color: "#0f172a" }}
                                      >
                                        {info?.title || c.id}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 12,
                                          color: reason ? "#000000" : "#94a3b8",
                                        }}
                                      >
                                        理由: {reason || "（なし）"}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                                  カードはありません
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ textAlign: "right", marginTop: 12 }}>
                    <button
                      onClick={() => setActiveUserInfo(null)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #e5e7eb",
                        borderRadius: 8,
                        background: "#fff",
                        fontWeight: 700,
                      }}
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

        {/* カード詳細モーダル */}
        {cardModal &&
          (() => {
            const info = getCard(cardModal.id);
            const users = selections.map((u) => {
              let category: string = "neutral";
              let reason = "";
              if (u.categories.veryWant.some((c) => c.id === cardModal.id)) {
                category = "veryWant";
                reason =
                  u.categories.veryWant.find((c) => c.id === cardModal.id)?.reason ||
                  "";
              } else if (u.categories.want.some((c) => c.id === cardModal.id))
                category = "want";
              else if (u.categories.dont.some((c) => c.id === cardModal.id))
                category = "dont";
              else if (u.categories.veryDont.some((c) => c.id === cardModal.id)) {
                category = "veryDont";
                reason =
                  u.categories.veryDont.find((c) => c.id === cardModal.id)?.reason ||
                  "";
              } else if (u.categories.neutral.some((c) => c.id === cardModal.id))
                category = "neutral";
              return {
                userName: u.userName,
                planName: u.planName || "—",
                category,
                reason,
              };
            });
            return (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 120,
                }}
                onClick={() => {
                  // 全員投票モードの最中は外クリックで閉じられない（全員統一表示を維持）
                  if (activeVote?.modalOpen) return;
                  closeCard();
                }}
              >
                <div
                  style={{
                    width: "min(92vw, 760px)",
                    background: "#fff",
                    borderRadius: 12,
                    overflow: "hidden",
                    boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      padding: 16,
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    <div
                      style={{
                        flex: "0 0 240px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                      }}
                    >
                      <div
                        onClick={() =>
                          setCardModal((m) => m && { ...m, flipped: !m.flipped })
                        }
                        style={{
                          width: 220,
                          height: 320,
                          cursor: "pointer",
                          border: "1px solid #e5e7eb",
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "#fff",
                        }}
                      >
                        <img
                          src={cardModal.flipped ? info?.backSrc || info?.src : info?.src}
                          alt={info?.title}
                          style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "#111827" }}>
                        {info?.title}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>
                        各ユーザーの選択（1人フェーズ時点）
                      </div>
                      <div style={{ display: "grid", gap: 8 }}>
                        {users.map((u, idx) => (
                          <div
                            key={idx}
                            style={{
                              border:
                                u.category === "veryWant" ? "2px solid #fca5a5" :
                                u.category === "want" ? "2px solid #fbcfe8" :
                                u.category === "neutral" ? "2px solid #d1d5db" :
                                u.category === "dont" ? "2px solid #93c5fd" :
                                u.category === "veryDont" ? "2px solid #60a5fa" :
                                "1px solid #e5e7eb",
                              background:
                                u.category === "veryWant" ? "#fecaca" :
                                u.category === "want" ? "#fce7f3" :
                                u.category === "neutral" ? "#e5e7eb" :
                                u.category === "dont" ? "#bae6fd" :
                                u.category === "veryDont" ? "#93c5fd" :
                                "#fff",
                              borderRadius: 10,
                              padding: 8,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <div style={{ fontWeight: 800 }}>{u.userName}</div>
                              <div
                                style={{
                                  fontSize: 12,
                                  fontWeight: 800,
                                  color: "#000000",
                                }}
                              >
                                プラン名：{u.planName}
                              </div>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "spaceBetween",
                                fontSize: 12,
                                gap: 8,
                                alignItems: "baseline",
                              }}
                            >
                              <div>
                                カテゴリ：
                                <strong
                                  style={{
                                    color:
                                      u.category === "veryWant" ? "#7f1d1d" :
                                      u.category === "want" ? "#9d174d" :
                                      u.category === "neutral" ? "#374151" :
                                      u.category === "dont" ? "#0c4a6e" :
                                      u.category === "veryDont" ? "#1e3a8a" :
                                      "#374151"
                                  }}
                                >
                                  {
                                    ({
                                      veryWant: "特に行きたい",
                                      want: "行きたい",
                                      neutral: "どちらでも",
                                      dont: "行きたくない",
                                      veryDont: "特に行きたくない",
                                    } as Record<string, string>)[u.category] || "—"
                                  }
                                </strong>
                              </div>
                              <div
                                style={{
                                  color: "#000000",
                                  marginLeft: "auto",
                                }}
                              >
                                理由: {u.reason || "（なし）"}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 8,
                      padding: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{
                      display: "flex",
                      gap: 12,
                      position: "relative",
                      justifyContent: "center",
                      alignItems: "center",
                      width: "100%",
                      padding: "0 20px"
                    }}>
                      {(() => {
                        const myChoice = myVoteChoice || voteMap[myUserId];
                        const hasVoted = !!myChoice;
                        const votedNo = myChoice === "no";
                        const votedGo = myChoice === "go";
                        const votedPending = myChoice === "pending";

                        const goCount = expectedVoteIds.reduce((acc, id) => {
                          const v = voteMap[id];
                          const mine = id === myUserId ? myVoteChoice || v : v;
                          return acc + (mine === "go" ? 1 : 0);
                        }, 0);
                        const noCount = expectedVoteIds.reduce((acc, id) => {
                          const v = voteMap[id];
                          const mine = id === myUserId ? myVoteChoice || v : v;
                          return acc + (mine === "no" ? 1 : 0);
                        }, 0);
                        const pendingCount = expectedVoteIds.reduce((acc, id) => {
                          const v = voteMap[id];
                          const mine = id === myUserId ? myVoteChoice || v : v;
                          return acc + (mine === "pending" ? 1 : 0);
                        }, 0);

                        const noStyle: any = {
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: votedNo ? "#172554" : "#1e3a8a",
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedNo
                            ? "0 0 0 3px rgba(30,58,138,0.35) inset"
                            : undefined,
                          transform: votedNo ? "translateY(1px)" : undefined,
                          transition: "all .12s ease",
                          opacity: hasVoted && !votedNo ? 0.6 : 1,
                          cursor: hasVoted && !votedNo ? "not-allowed" : "pointer",
                        };
                        const goStyle: any = {
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: votedGo ? "#b91c1c" : "#ef4444",
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedGo
                            ? "0 0 0 3px rgba(239,68,68,0.35) inset"
                            : undefined,
                          transform: votedGo ? "translateY(1px)" : undefined,
                          transition: "all .12s ease",
                          opacity: hasVoted && !votedGo ? 0.6 : 1,
                          cursor: hasVoted && !votedGo ? "not-allowed" : "pointer",
                        };
                        const pendingStyle: any = {
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: votedPending ? "#a16207" : "#eab308",
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedPending
                            ? "0 0 0 3px rgba(234,179,8,0.35) inset"
                            : undefined,
                          transform: votedPending ? "translateY(1px)" : undefined,
                          transition: "all .12s ease",
                          opacity: hasVoted && !votedPending ? 0.6 : 1,
                          cursor: hasVoted && !votedPending ? "not-allowed" : "pointer",
                        };

                        // 「投票済み x/y」も実参加者ベース（w/4 固定を解消）
                        const totalParticipantsCount = displayParticipants.length;
                        const votedCount = displayParticipants.reduce((acc, p) => {
                          const v = voteMap[p.id];
                          const mine = p.id === myUserId ? (myVoteChoice || v) : v;
                          return acc + (mine ? 1 : 0);
                        }, 0);

                        console.log('Vote progress calculation:', {
                          displayParticipants: displayParticipants.map(p => ({ id: p.id, name: p.name })),
                          totalParticipantsCount,
                          votedCount,
                          voteMap,
                          myUserId,
                          myVoteChoice
                        });

                        return (
                          <>
                            <div
                              style={{
                                position: "absolute",
                                top: -24,
                                right: 0,
                                fontSize: 11,
                                fontWeight: 800,
                                color: "#374151",
                                background: "rgba(255,255,255,0.8)",
                                padding: "2px 6px",
                                borderRadius: 8,
                              }}
                            >
                              投票済み {votedCount}/{totalParticipantsCount}
                            </div>

                            {/* 投票開始メッセージ */}
                            {activeVote?.modalOpen && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: -60,
                                  right: 0,
                                  fontSize: 12,
                                  fontWeight: 800,
                                  color: "#059669",
                                  background: "rgba(5, 150, 105, 0.1)",
                                  padding: "8px 16px",
                                  borderRadius: 8,
                                  border: "1px solid #10b981",
                                  textAlign: "center",
                                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                                  width: "220px",
                                  zIndex: 10,
                                  marginLeft: "auto",
                                }}
                              >
                                投票しましょう
                              </div>
                            )}

                            <div style={{ position: "relative" }}>
                              <button
                                aria-pressed={votedNo}
                                disabled={hasVoted && !votedNo}
                                onClick={() => {
                                  console.log('No button clicked:', { 
                                    hasVoted, 
                                    activeVote: activeVote?.modalOpen, 
                                    cardId: activeVote?.cardId, 
                                    modalCardId: cardModal.id 
                                  });
                                  if (!hasVoted) {
                                    if (activeVote?.modalOpen && activeVote.cardId === cardModal.id) {
                                      castVote("no");
                                    } else {
                                      startVote("no", cardModal.id);
                                    }
                                  }
                                }}
                                style={noStyle}
                              >
                                行かない
                              </button>
                              <div
                                style={{
                                  position: "absolute",
                                  top: -12,
                                  right: -12,
                                  display: "flex",
                                  zIndex: 5,
                                  pointerEvents: "none",
                                }}
                              >
                                {renderVoteAvatars("no")}
                              </div>
                            </div>

                            <div style={{ position: "relative" }}>
                              <button
                                aria-pressed={votedPending}
                                disabled={hasVoted && !votedPending}
                                onClick={() => {
                                  console.log('Pending button clicked:', { 
                                    hasVoted, 
                                    activeVote: activeVote?.modalOpen, 
                                    cardId: activeVote?.cardId, 
                                    modalCardId: cardModal.id 
                                  });
                                  if (!hasVoted) {
                                    if (activeVote?.modalOpen && activeVote.cardId === cardModal.id) {
                                      castVote("pending");
                                    } else {
                                      startVote("pending", cardModal.id);
                                    }
                                  }
                                }}
                                style={pendingStyle}
                              >
                                保留
                              </button>
                              <div
                                style={{
                                  position: "absolute",
                                  top: -12,
                                  right: -12,
                                  display: "flex",
                                  zIndex: 5,
                                  pointerEvents: "none",
                                }}
                              >
                                {renderVoteAvatars("pending")}
                              </div>
                            </div>

                            <div style={{ position: "relative" }}>
                              <button
                                aria-pressed={votedGo}
                                disabled={hasVoted && !votedGo}
                                onClick={() => {
                                  console.log('Go button clicked:', { 
                                    hasVoted, 
                                    activeVote: activeVote?.modalOpen, 
                                    cardId: activeVote?.cardId, 
                                    modalCardId: cardModal.id 
                                  });
                                  if (!hasVoted) {
                                    if (activeVote?.modalOpen && activeVote.cardId === cardModal.id) {
                                      castVote("go");
                                    } else {
                                      startVote("go", cardModal.id);
                                    }
                                  }
                                }}
                                style={goStyle}
                              >
                                行く
                              </button>
                              <div
                                style={{
                                  position: "absolute",
                                  top: -12,
                                  right: -12,
                                  display: "flex",
                                  zIndex: 5,
                                  pointerEvents: "none",
                                }}
                              >
                                {renderVoteAvatars("go")}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

        {/* スティッキーフッター（終了） */}
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 80,
        }}
      >
        <button
          disabled={vsSorted.length > 0 || uiLocked}
          onClick={async () => {
            if (!roomId || typeof roomId !== "string" || !userName) return;
            await setDoc(
              doc(db, "rooms", roomId, "play3Ready", userName),
              {
                userId: userName,
                ready: true,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
            setUiLocked(true);
            setUiLockReason("migrate");
          }}
          style={{
            opacity: vsSorted.length > 0 || uiLocked ? 0.5 : 1,
            background: "linear-gradient(135deg,#2563eb,#4f46e5)",
            color: "#fff",
            fontWeight: 900,
            padding: "12px 18px",
            border: "none",
            borderRadius: 12,
            boxShadow: "0 10px 28px -8px rgba(37,99,235,0.55)",
            cursor: vsSorted.length > 0 || uiLocked ? "not-allowed" : "pointer",
          }}
        >
          終了して結果を見る
        </button>
      </div>

      {/* ロック中オーバーレイ（全員の「終了」待ち） */}
      {uiLocked &&
        uiLockReason === "migrate" &&
        (() => {
          // 参加者ベースでready状況を計算
          const actualParticipantCount = displayParticipants.length;
          const readyCount = displayParticipants.reduce((acc, participant) => {
            return acc + (play3Ready[participant.id] ? 1 : 0);
          }, 0);
          
          return (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(255,255,255,0.7)",
                backdropFilter: "blur(2px)",
                zIndex: 200,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
              }}
            >
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 16,
                  boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                  fontWeight: 800,
                  color: "#0f172a",
                }}
              >
                投票を送信しました。他の参加者の投票完了を待っています…（
                {readyCount}/{actualParticipantCount}）
              </div>
            </div>
          );
        })()}
    </div>
  );
}
