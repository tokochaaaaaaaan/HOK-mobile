"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  getDocs,
  serverTimestamp,
  runTransaction,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../../../lib/firebase";
import { listenToPresence } from "../../../../../lib/firebase-utils-safe";
import {
  agreementForCard,
  agreementOverall,
  convertSelectionsToMatrix,
} from "../../../../utils/agreement-calculator";
import { normalizeCategories } from "../../../../utils/normalizeCategories";
import MapButton from "@/components/MapButton";
import NoteWindow from "../components/NoteWindow";
import styles from "./page.module.css";
import { parseReason } from "../../../../utils/reasonIcons";
import { cards as baseCards } from "@/data/cards";

const PLAY3_VOTE_SESSIONS = "play3VoteSessions";
const PLAY3_VOTE_RESULTS = "play3VoteResults";


type VoteChoice = "go" | "no" | "pending";
type VotePhase = "idle" | "voting" | "finalizing" | "finished";
type ActiveVoteState = {
  phase: VotePhase;
  cardId: string | null;
  sessionId: string | null;
  round: number;
  expectedUserIds: string[];
  createdAt: number;
  startedBy?: string;
  finalizedAt?: number;
  finalizedBy?: string;
  resultRef?: string;
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

  // ページ離脱防止の強化（リロード・タブを閉じる時に警告）
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // Chrome requires returnValue to be set
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Next.jsルーター遷移のブロック（別ページへの遷移を防ぐ）
  useEffect(() => {
    const currentPath = window.location.pathname;
    
    // popstateイベントで戻る/進むをブロック
    const handlePopState = (e: PopStateEvent) => {
      e.preventDefault();
      // 強制的に現在のページに戻す
      window.history.pushState(null, '', currentPath);
    };

    // hashchangeイベントもブロック
    const handleHashChange = (e: HashChangeEvent) => {
      e.preventDefault();
      window.location.hash = '';
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handleHashChange);

    // 初期状態を履歴に追加
    window.history.pushState(null, '', currentPath);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Scale機能を削除して、常に画面全体を使用

  // カード定義（39枚）
  const ALL_CARDS = useMemo(
    () =>
      baseCards.map((c) => ({
        id: `card${c.id}`,
        title: c.title,
        src: c.frontSrc,
        backSrc: c.backSrc,
      })),
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
  const [voteCompletedIds, setVoteCompletedIds] = useState<Set<string>>(new Set());
  const [assignLoaded, setAssignLoaded] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 参加者情報モーダル用
  const [activeUserInfo, setActiveUserInfo] = useState<string | null>(null);
  const [userInfoExpanded, setUserInfoExpanded] = useState<
    Record<string, boolean>
  >({});

  // waiting_result_lastからの最終結果データ
  const [waitingResultLast, setWaitingResultLast] = useState<Record<string, any>>({});
  // ホスト設定の最小訪問数を取得
  const [minStops, setMinStops] = useState<number>(6);
  // 終了確認モーダル
  const [showEndConfirm, setShowEndConfirm] = useState<boolean>(false);
  // 実験用：基準時刻（全員play3到達時点）
  const [baseTimestamp, setBaseTimestamp] = useState<number | null>(null);
  // 強制終了（3秒長押し）確認モーダル
  const [showForceEndConfirm, setShowForceEndConfirm] = useState<boolean>(false);
  const forceEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceEndTriggeredRef = useRef<boolean>(false);


  // ルームに保存された参加者（id→name の辞書を rooms/{roomId} に持つ想定）
  const [roomParticipants, setRoomParticipants] = useState<
    { id: string; name: string; joinedAt: number }[]
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
      const list = Object.entries(parts).map(([id, value]) => {
        // participants[id] が { name, joinedAt } の形式か、単純な文字列かを判定
        const valueData = value as any;
        const name = typeof valueData === 'string' 
          ? (valueData.trim().length > 0 ? valueData.trim() : id)
          : (valueData?.name?.trim() || id);
        const joinedAt = typeof valueData === 'string' ? 0 : (valueData?.joinedAt || 0);
        
        return {
          id,
          name,
          joinedAt,
        };
      });
      
      // joinedAt順でソート（入室順）
      list.sort((a, b) => a.joinedAt - b.joinedAt);
      
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
  // Firestoreからルーム情報（minStops）を取得
  useEffect(() => {
    if (!roomId || typeof roomId !== 'string') return;
    const roomRef = doc(db, "rooms", roomId);
    const unsub = onSnapshot(roomRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.minStops !== undefined) {
          setMinStops(data.minStops);
        }
      }
    });
    return () => unsub();
  }, [roomId]);


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
    const map = new Map<string, { id: string; name: string; plan: string; joinedAt: number }>();

    const ensure = (
      rawId?: string | null,
      nameHint?: string | null,
      planHint?: string | null,
      joinedAtHint?: number
    ) => {
      const trimmedId = rawId?.trim();
      if (!trimmedId) return null;
      const resolvedName = nameHint?.trim();
      const resolvedPlan = planHint || "";
      const resolvedJoinedAt = joinedAtHint || 0;
      const existing = map.get(trimmedId);
      if (existing) {
        let nextName = existing.name;
        let nextPlan = existing.plan;
        let nextJoinedAt = existing.joinedAt;
        if (
          resolvedName &&
          (existing.name === existing.id || existing.name.trim().length === 0)
        ) {
          nextName = resolvedName;
        }
        if (!nextPlan && resolvedPlan) {
          nextPlan = resolvedPlan;
        }
        if (!nextJoinedAt && resolvedJoinedAt) {
          nextJoinedAt = resolvedJoinedAt;
        }
        if (nextName !== existing.name || nextPlan !== existing.plan || nextJoinedAt !== existing.joinedAt) {
          map.set(trimmedId, { id: trimmedId, name: nextName, plan: nextPlan, joinedAt: nextJoinedAt });
        }
        return trimmedId;
      }
      map.set(trimmedId, {
        id: trimmedId,
        name: resolvedName || trimmedId,
        plan: resolvedPlan,
        joinedAt: resolvedJoinedAt
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
        return ensure(roomMatch.id, roomMatch.name, planHint, roomMatch.joinedAt);
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
        return ensure(id, name, selectionMatch.planName || planHint, 0);
      }

      return ensure(trimmed, trimmed, planHint, 0);
    };

    roomParticipants.forEach((p) => {
      ensure(p.id, p.name, "", p.joinedAt);
    });

    selections.forEach((s) => {
      resolveFromAny(s.userId || s.user, s.planName || "");
    });

    if (sessionParticipantId) {
      ensure(
        sessionParticipantId,
        normalizedUserName || userName || sessionParticipantId,
        "",
        0
      );
    } else if (localUserId) {
      ensure(localUserId, normalizedUserName || userName || localUserId, "", 0);
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
        .map((id) => map.get(id) || { id, name: id, plan: "", joinedAt: 0 })
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
  const [lastSeenRoundByCard, setLastSeenRoundByCard] = useState<Record<string, number>>({});

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

    let result = validParticipants;
    
    if (!selfIncluded) {
      // 自分が含まれていない場合は追加
      if (myUserId && normalizedUserName) {
        result = [
          ...validParticipants,
          { id: myUserId, name: normalizedUserName, plan: "", joinedAt: 0 },
        ];
      }
    }
    
    // joinedAt順（入室順）でソート
    return result.sort((a, b) => a.joinedAt - b.joinedAt);
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

  // expectedVoteIds: セッションのexpectedUserIdsを優先（なければdisplayParticipants）
  const expectedVoteIds = useMemo(() => {
    if (activeVote?.expectedUserIds?.length) {
      const ids = activeVote.expectedUserIds.map((id) => id?.trim()).filter(Boolean);
      return Array.from(new Set(ids));
    }
    const ids = displayParticipants.map((p) => p.id?.trim()).filter(Boolean);
    return Array.from(new Set(ids));
  }, [activeVote?.expectedUserIds, displayParticipants]);


  const participantMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; plan: string; joinedAt: number }>();
    
    displayParticipants.forEach((p) => {
      // waiting_result_lastから情報を取得（存在する場合は優先）
      const waitingResult = waitingResultLast[p.name];
      
      if (waitingResult) {
        // waiting_result_lastにデータがある場合はそれを使用
        map.set(p.id, {
          id: p.id,
          name: waitingResult.userName || p.name,
          plan: waitingResult.planName || p.plan,
          joinedAt: p.joinedAt,
        });
      } else {
        // waiting_result_lastにデータがない場合は元の情報を使用
        map.set(p.id, p);
      }
    });
    
    return map;
  }, [displayParticipants, waitingResultLast]);

  const initiatorDisplayName = useMemo(() => {
    if (!activeVote) return "";
    if (activeVote.startedBy) {
      const found = participantMap.get(activeVote.startedBy);
      if (found?.name) return found.name;
    }
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

  // 移行（結果へ）準備状況 - play3Result コレクション
  const [play3Ready, setPlay3Ready] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qResult = query(collection(db, "rooms", roomId, "play3Result"));
    const unsub = onSnapshot(qResult, (snap) => {
      const map: Record<string, boolean> = {};
      snap.docs.forEach((d) => {
        const data: any = d.data();
        // trueの判定があれば準備完了とする
        if (data?.ready === true || data?.completed === true) {
          map[d.id] = true;
        }
      });
      setPlay3Ready(map);
      
      console.log('play3Result購読:', {
        docs: snap.docs.map(d => ({ id: d.id, data: d.data() })),
        resultMap: map
      });
    });
    return () => unsub();
  }, [roomId]);

  // ✅ displayParticipants ベースで準備完了判定
  useEffect(() => {
    const actualParticipantCount = displayParticipants.length;
    const readyCount = displayParticipants.reduce((acc, participant) => {
      return acc + (play3Ready[participant.id] ? 1 : 0);
    }, 0);

    console.log("[Play3 Navigation Check]", {
      actualParticipantCount,
      readyCount,
      vsIdsLength: vsIds.length,
      displayParticipants: displayParticipants.map(p => ({ id: p.id, name: p.name })),
      play3Ready,
      willNavigate: actualParticipantCount > 0 && readyCount === actualParticipantCount && vsIds.length === 0
    });

    if (actualParticipantCount > 0 && readyCount === actualParticipantCount && vsIds.length === 0) {
      console.log("[Play3] ✅ Navigating to result page");
      
      // 実験用：result遷移時刻を記録
      if (baseTimestamp && roomId) {
        const now = Date.now();
        const elapsed = now - baseTimestamp;
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const ms = elapsed % 1000;
        
        setDoc(
          doc(db, "rooms", roomId as string, "play3Timing", "result_transition"),
          {
            event: "result_transition",
            timestamp: now,
            baseTimestamp,
            elapsedMs: elapsed,
            elapsedFormatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(ms).padStart(3, '0')}`,
            userId: myUserId,
            userName: normalizedUserName || userName,
          },
          { merge: true }
        ).catch(e => console.error("result遷移時刻記録エラー:", e));
      }
      
      router.push(`/room/${roomId}/result`);
    }
  }, [play3Ready, displayParticipants, vsIds.length, router, roomId, baseTimestamp, myUserId, normalizedUserName, userName]);


  // finalSelections 購読（waitingページで確定したデータのみ使用）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qSel = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsub = onSnapshot(qSel, (snap) => {
      const list: Selections = [] as any;
      snap.docs.forEach((d) => {
        const data: any = d.data();
        
        // waitingページで確定したデータのみを使用
        if (!data.isReady) {
          console.log('Play3: Skipping non-ready user:', d.id);
          return;
        }
        
        // match-resultと同じロジック: 統一フォーマット優先
        let categories;
        if (data.categories) {
          categories = data.categories;
        } else if (data.verywant || data.verydont || data.want || data.dont) {
          // 旧形式から構築
          categories = {
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
        } else {
          categories = {
            veryWant: [],
            want: [],
            neutral: [],
            dont: [],
            veryDont: [],
          };
        }
        
        list.push({
          user: data.user || data.userId || data.userName || d.id,
          userId: data.userId || data.user || data.userName || d.id,
          userName: data.userName || data.user || data.userId || d.id,
          planName: data.planName || data.planname || "",
          categories: {
            veryWant: (categories.veryWant || []).map((c: any) => ({
              id: c.id,
              reason: c.reason,
            })),
            want: (categories.want || []).map((c: any) => ({ id: c.id })),
            neutral: (categories.neutral || []).map((c: any) => ({ id: c.id })),
            dont: (categories.dont || []).map((c: any) => ({ id: c.id })),
            veryDont: (categories.veryDont || []).map((c: any) => ({
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

  // waiting_result_lastから最終結果を購読
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    
    const unsubscribers: (() => void)[] = [];
    const resultMap: Record<string, any> = {};
    
    // 各participantのwaiting_result_lastを購読
    roomParticipants.forEach((participant) => {
      const resultRef = doc(
        db,
        "waiting_result_last",
        participant.name,
        "result_last",
        "final"
      );
      
      const unsub = onSnapshot(resultRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          resultMap[participant.name] = {
            userName: data.userName,
            planName: data.planName,
            submittedAt: data.submittedAt,
            finalPlacement: data.finalPlacement,
            timestamp: data.timestamp,
          };
          
          console.log(`waiting_result_last loaded for ${participant.name}:`, resultMap[participant.name]);
          setWaitingResultLast({ ...resultMap });
        }
      });
      
      unsubscribers.push(unsub);
    });
    
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [roomId, roomParticipants]);

  // 合致率計算（全体・カード別）
  useEffect(() => {
    if (!selections.length) return;
    const matrix = convertSelectionsToMatrix(selections as any, 39);
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
      const voteCompleted: Set<string> = new Set();
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.status === "go") go.push(d.id);
        else if (data?.status === "no") no.push(d.id);
        else if (data?.status === "vs") vs.push(d.id);
        else if (data?.status === "neutral") neu.push(d.id);
        if (data?.pending) pending.add(d.id);
        if (data?.hasBlackBorder) blackBorder.add(d.id);
        if (data?.voteCompleted) voteCompleted.add(d.id);
      });
      setGoIds(go);
      setNoIds(no);
      setVsIds(vs);
      setNeutralIds(neu);
      setPendingIds(pending);
      setBlackBorderIds(blackBorder);
      setVoteCompletedIds(voteCompleted);
      setAssignLoaded(true);
    });
    return () => unsub();
  }, [roomId]);

  // 初期自動配置（waiting_result_lastを優先、フォールバックとしてselectionsを使用）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    if (!assignLoaded) return;
    
    // waiting_result_lastとselectionsの両方が必要
    const hasWaitingResults = Object.keys(waitingResultLast).length > 0;
    const hasSelections = selections.length > 0;
    
    // どちらかのデータがあれば実行（全員分揃うのを待たない）
    if (!hasWaitingResults && !hasSelections) return;
    
    // 実験用：全員がplay3に到達したと判定 → 基準時刻を記録（初回のみ）
    if (baseTimestamp === null && displayParticipants.length > 0) {
      const now = Date.now();
      setBaseTimestamp(now);
      
      setDoc(
        doc(db, "rooms", roomId, "play3Timing", "base"),
        {
          event: "all_arrived",
          timestamp: now,
          elapsedFormatted: "00:00:00:00",
          participantCount: displayParticipants.length,
          participants: displayParticipants.map(p => ({ id: p.id, name: p.name })),
        },
        { merge: true }
      ).catch(e => console.error("基準時刻記録エラー:", e));
    }

    const byCard = (id: string) => {
      const results: Array<{
        veryWant: boolean;
        want: boolean;
        neutral: boolean;
        dont: boolean;
        veryDont: boolean;
      }> = [];
      
      // waiting_result_lastから取得（優先）
      Object.values(waitingResultLast).forEach((result: any) => {
        if (result?.finalPlacement) {
          const placement = result.finalPlacement;
          results.push({
            veryWant: (placement.veryWant || []).some((c: any) => c.cardId === id),
            want: (placement.want || []).some((c: any) => c.cardId === id),
            neutral: (placement.neutral || []).some((c: any) => c.cardId === id),
            dont: (placement.dont || []).some((c: any) => c.cardId === id),
            veryDont: (placement.veryDont || []).some((c: any) => c.cardId === id),
          });
        }
      });
      
      // フォールバック: selectionsから取得（waiting_result_lastにないユーザー用）
      selections.forEach((s) => {
        // このユーザーが既にwaiting_result_lastにいるかチェック
        const alreadyInWaiting = Object.values(waitingResultLast).some(
          (w: any) => w.userName === s.userName
        );
        
        if (!alreadyInWaiting) {
          results.push({
            veryWant: s.categories.veryWant.some((c) => c.id === id),
            want: s.categories.want.some((c) => c.id === id),
            neutral: s.categories.neutral.some((c) => c.id === id),
            dont: s.categories.dont.some((c) => c.id === id),
            veryDont: s.categories.veryDont.some((c) => c.id === id),
          });
        }
      });
      
      return results;
    };

    const initWrites = async () => {
      console.log('[Play3] カード振り分け開始:', { 
        waitingResultsCount: Object.keys(waitingResultLast).length,
        selectionsCount: selections.length,
        allCardsCount: ALL_CARDS.length 
      });
      
      for (const card of ALL_CARDS) {
        const arr = byCard(card.id);
        
        // データがない場合はスキップ
        if (arr.length === 0) continue;
        
        // 各カテゴリに該当する人がいるかチェック
        const hasPositive = arr.some((a) => a.veryWant || a.want);
        const hasNegative = arr.some((a) => a.veryDont || a.dont);
        const allNeutral = arr.length > 0 && arr.every((a) => a.neutral);
        
        let status: "go" | "no" | "vs" | "neutral" = "neutral";
        
        // ルール3: 誰かが「行きたい」系 AND 誰かが「行きたくない」系 → 議論中(VS)
        if (hasPositive && hasNegative) {
          status = "vs";
        }
        // ルール2: 全員が「どちらでもいい」 → どちらでもいい
        else if (allNeutral) {
          status = "neutral";
        }
        // ルール1: 誰かが「行きたくない」系で、他は「どちらでもいい」か「行きたくない」系のみ → 行かない
        else if (hasNegative && !hasPositive) {
          status = "no";
        }
        // それ以外で誰かが「行きたい」系がいる → 行く
        else if (hasPositive && !hasNegative) {
          status = "go";
        }
        // 上記いずれにも該当しない（空データなど） → どちらでもいい
        else {
          status = "neutral";
        }
        
        console.log(`[Play3] ${card.title} -> ${status}`, {
          hasPositive,
          hasNegative,
          allNeutral,
          dataCount: arr.length,
          details: arr
        });
        
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
      console.log('[Play3] カード振り分け完了');
      setInitialized(true);
    };
    initWrites();
  }, [
    assignLoaded,
    waitingResultLast,
    selections,
    roomId,
    userName,
    ALL_CARDS,
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

  // VS用ソート: 合致率が低い順 → 同率ならカード番号順
  const sortVsByAgreementAndNumber = useCallback(
    (ids: string[]) => {
      return [...ids].sort((a, b) => {
        const agreeA = agreementMap.get(a) || 0;
        const agreeB = agreementMap.get(b) || 0;
        
        // 合致率が低い順（昇順）
        if (agreeA !== agreeB) {
          return agreeA - agreeB;
        }
        
        // 合致率が同じ場合はカード番号順
        const numA = parseInt(a.replace('card', ''), 10);
        const numB = parseInt(b.replace('card', ''), 10);
        return numA - numB;
      });
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
    const isVotingActive = activeVote?.phase === "voting" || activeVote?.phase === "finalizing";

    return (
      <div style={{ display: "flex", gap: 8 }}>
        {actualParticipants.map((p) => {
          // 投票状況をチェック
          const hasVoted = isVotingActive ? !!(voteMap[p.id] || (p.id === myUserId && myVoteChoice)) : false;
          const isUnvoted = isVotingActive && !hasVoted;
          const isMyself = p.id === myUserId; // 自分のアイコンかどうか

          return (
            <button
              key={p.id}
              onClick={() => {
                console.log('[Play3] Avatar clicked:', { id: p.id, name: p.name });
                setActiveUserInfo(p.id);
              }}
              title={`${p.name} (${p.id}) ${isVotingActive ? (hasVoted ? "投票済み" : "未投票") : ""}`}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: isMyself ? "2px solid #ef4444" : "1px solid #e5e7eb", // 自分は赤枠
                background: isUnvoted ? "#4b5563" : "#fff", // 未投票者は黒塗り
                boxShadow: isMyself ? "0 0 0 2px rgba(239, 68, 68, 0.2)" : "0 2px 6px rgba(0,0,0,0.08)", // 自分は赤い影
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
  };

  const getCard = (id: string) => ALL_CARDS.find((c) => c.id === id);

  // カードモーダル
  const [cardModal, setCardModal] = useState<{ id: string; flipped: boolean } | null>(null);
  const [isCardModalMinimized, setIsCardModalMinimized] = useState(false);
  const [votingCardId, setVotingCardId] = useState<string | null>(null); // 投票中のカードIDを保持
  
  const openCard = (id: string) => {
    // 投票中かどうか確認
    const isVoting = activeVote?.phase === "voting" || activeVote?.phase === "finalizing";
    
    if (isVoting && votingCardId) {
      // 投票中の場合
      if (id === votingCardId) {
        // 投票カードをクリック：最小化中なら展開、通常表示なら何もしない
        if (isCardModalMinimized) {
          setIsCardModalMinimized(false);
        }
        return;
      } else {
        // 投票カード以外をクリック：参照用に開く（投票小ウィンドウは維持）
        setCardModal({ id, flipped: false });
        setIsCardModalMinimized(false);
        return;
      }
    }
    
    // 投票中でない場合：通常通り開く
    setCardModal({ id, flipped: false });
    setIsCardModalMinimized(false);
  };
  
  const closeCard = () => {
    // 投票中の場合は、投票小ウィンドウに戻る
    if (votingCardId && (activeVote?.phase === "voting" || activeVote?.phase === "finalizing")) {
      setCardModal({ id: votingCardId, flipped: false });
      setIsCardModalMinimized(true);
      return;
    }
    setCardModal(null);
    setIsCardModalMinimized(false);
  };
  const [uiLocked, setUiLocked] = useState(false);
  
  // 投票結果表示モーダル
  const [voteResultModal, setVoteResultModal] = useState<{ cardId: string; cardName: string; message: string } | null>(null);
  const [lastVoteResultTimestamp, setLastVoteResultTimestamp] = useState<number>(0);
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

  // 状態購読（全員へモーダル同期 + クライアント側ガード）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const unsub = onSnapshot(doc(db, "rooms", roomId, "play3State", "state"), (snap) => {
      const data: any = snap.data();
      console.log('play3State更新を受信:', data);
      
      if (data) {
        // 後方互換性: phase ?? modalOpen で phase 判定
        const inferredPhase: VotePhase = 
          data.phase || 
          (data.modalOpen ? "voting" : "idle");
        
        const cardId = data.cardId || null;
        const round = typeof data.round === "number" ? data.round : 0;

        // クライアント側ガード: 同じroundの投票ウィンドウは再表示しない
        if (cardId && lastSeenRoundByCard[cardId] >= round) {
          console.log(`クライアント側ガード: ${cardId} round ${round} は既に表示済み`);
          return;
        }

        if (cardId && round > 0) {
          setLastSeenRoundByCard((prev) => ({
            ...prev,
            [cardId]: round,
          }));
        }
        
        const next: ActiveVoteState = {
          phase: inferredPhase,
          cardId,
          sessionId: data.sessionId || null,
          round,
          expectedUserIds: Array.isArray(data.expectedUserIds)
            ? (data.expectedUserIds as string[])
            : [],
          createdAt: data.createdAt || 0,
          startedBy: data.initiatedById || data.initiatedBy,
          finalizedAt: data.finalizedAt,
          finalizedBy: data.finalizedBy,
          resultRef: data.resultRef,
        };
        setActiveVote(next);
        if ((next.phase === "voting" || next.phase === "finalizing") && next.cardId) {
          const cid = next.cardId;
          setVotingCardId(cid); // 投票中のカードIDを記録
          setCardModal((m) => (m?.id === cid ? m : { id: cid, flipped: false }));
          setIsCardModalMinimized(false);
        } else if (next.phase === "idle" || next.phase === "finished") {
          // 投票終了時は投票カードIDをクリアし、投票ウィンドウを全て無くす
          setVotingCardId(null);
          setCardModal(null);
          setIsCardModalMinimized(false);
        }
        
        // 投票結果を全員に表示（新しいタイムスタンプのみ）
        if (data.voteResult && data.voteResult.timestamp) {
          const newTimestamp = data.voteResult.timestamp;
          console.log('voteResult検出:', {
            newTimestamp,
            lastVoteResultTimestamp,
            shouldShow: newTimestamp > lastVoteResultTimestamp,
            voteResult: data.voteResult
          });
          
          if (newTimestamp > lastVoteResultTimestamp) {
            console.log('新しい投票結果を表示:', data.voteResult);
            setLastVoteResultTimestamp(newTimestamp);
            setVoteResultModal({
              cardId: data.voteResult.cardId,
              cardName: data.voteResult.cardName,
              message: data.voteResult.message,
            });
            // 投票結果が表示されたらカードモーダルを閉じる
            setCardModal(null);
            setIsCardModalMinimized(false);
          }
        } else if (data.voteResult === null && voteResultModal) {
          // voteResultがnullになったら、全員のモーダルを閉じる
          console.log('voteResultが削除されたため、モーダルを閉じます');
          setVoteResultModal(null);
        }
      } else {
        setActiveVote(null);
      }
    });
    return () => unsub();
  }, [roomId, lastVoteResultTimestamp, voteResultModal, lastSeenRoundByCard]);

  // 投票状況購読（voting/finalizing phase のみ）
  // ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
  // 投票状況購読（ballots サブコレクションを購読）
  // ――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const sessionId = activeVote?.sessionId;
    const phase = activeVote?.phase;
    
    // voting または finalizing フェーズのみ購読
    if (!sessionId || (phase !== "voting" && phase !== "finalizing")) {
      setVoteMap({});
      // setMyVoteChoice(null);  // ←投票中の一瞬で票が消えるのを防ぐ
      return;
    }

    // validIds は expectedUserIds に固定
    const expectedIds = activeVote?.expectedUserIds ?? [];
    const validIds = new Set(expectedIds);

    const ballotsCol = collection(
      db,
      "rooms",
      roomId,
      PLAY3_VOTE_SESSIONS,
      sessionId,
      "ballots"
    );

    const unsub = onSnapshot(ballotsCol, (snap) => {
      const normalized: Record<string, VoteChoice> = {};

      snap.forEach((d) => {
        const data = d.data() as any;
        const uid = (data.userId || d.id || "").trim();
        const choice = data.choice as VoteChoice;

        if (!uid) return;
        if (!validIds.has(uid)) return;
        if (choice !== "go" && choice !== "no" && choice !== "pending") return;

        normalized[uid] = choice;
      });

      // 楽観更新した自分の票を補完
      if (
        myUserId &&
        myVoteChoice &&
        validIds.has(myUserId) &&
        !normalized[myUserId]
      ) {
        normalized[myUserId] = myVoteChoice;
      }

      setVoteMap(normalized);

      // サーバに自分の票があれば同期
      if (myUserId && normalized[myUserId]) {
        setMyVoteChoice(normalized[myUserId]);
      }
    });

    return () => unsub();
  }, [
    roomId,
    activeVote?.sessionId,
    activeVote?.phase,
    activeVote?.round,
    activeVote?.expectedUserIds,
    myUserId,
    myVoteChoice,
  ]);

  // 全員投票完了で自動判定・クローズ（transactionベースのphaseロック）
  useEffect(() => {
    const phase = activeVote?.phase;
    if (phase !== "voting") return;
    
    const expectedIds = activeVote?.expectedUserIds?.length
      ? activeVote.expectedUserIds.map((id) => id?.trim()).filter(Boolean)
      : displayParticipants.map((p) => p.id).filter(Boolean);
    const total = expectedIds.length;
    const cardId = activeVote?.cardId;
    const sessionId = activeVote?.sessionId;
    if (total <= 0 || !cardId || !sessionId) return;

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
      console.log('全員投票完了 - 集計処理を開始');
      
      (async () => {
        try {
          // 0.2秒待機（書き込み遅延吸収）
          await new Promise((r) => setTimeout(r, 200));
          
          if (!roomId || !cardId || !sessionId) return;
          
          // Transaction: voting → finalizing への排他的遷移
          const acquiredLock = await runTransaction(db, async (transaction) => {
            const sessionRef = doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId);
            const sessionSnap = await transaction.get(sessionRef);
            
            if (!sessionSnap.exists()) {
              console.log('セッションが存在しません');
              return false;
            }
            
            const sessionData = sessionSnap.data();
            const currentPhase = sessionData.phase;
            
            // 既にfinalizing/finishedなら処理しない
            if (currentPhase === "finalizing" || currentPhase === "finished") {
              console.log('既に集計処理中または完了:', currentPhase);
              return false;
            }
            
            // voting → finalizing に遷移（最初の1人だけ成功）
            transaction.update(sessionRef, {
              phase: "finalizing" as VotePhase,
              updatedAt: serverTimestamp(),
            });
            
            // play3State も finalizing に更新
            const stateRef = doc(db, "rooms", roomId, "play3State", "state");
            transaction.update(stateRef, {
              phase: "finalizing" as VotePhase,
              updatedAt: serverTimestamp(),
              // 後方互換性のため modalOpen は維持
            });
            
            console.log('finalizingフェーズロック獲得成功');
            return true;
          });
          
          if (!acquiredLock) {
            console.log('他の端末が既に集計処理中');
            return;
          }
          
          // --- ロック獲得成功後 ---

          // 1) session doc確認（phaseなど）
          const sessionDocRef = doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId);
          const sessionSnap = await getDoc(sessionDocRef);

          if (!sessionSnap.exists()) {
            console.error("セッションドキュメントが見つかりません");
            return;
          }

          const sessionData = sessionSnap.data() as any;

          // expectedUserIds は session/state のどちらでもOK（ズレない方を正に）
          const expectedIds: string[] = Array.isArray(sessionData.expectedUserIds)
            ? sessionData.expectedUserIds
            : (activeVote?.expectedUserIds ?? []);

          if (!expectedIds.length) {
            console.error("expectedUserIds が空です");
            // stuck防止：finalizing解除（戻す）
            await setDoc(sessionDocRef, { phase: "voting", updatedAt: serverTimestamp() }, { merge: true });
            await setDoc(doc(db, "rooms", roomId, "play3State", "state"), { phase: "voting" }, { merge: true });
            return;
          }

          // 2) ballots を正本として取得して集計
          const ballotsSnap = await getDocs(
            collection(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId, "ballots")
          );

          // ballots -> map
          const ballotMap: Record<string, VoteChoice> = {};
          ballotsSnap.forEach((d) => {
            const data = d.data() as any;
            const uid = String(data.userId ?? d.id ?? "").trim();
            const choice = data.choice as VoteChoice;
            if (!uid) return;
            if (choice !== "go" && choice !== "no" && choice !== "pending") return;
            ballotMap[uid] = choice;
          });

          // 3) 全員分揃ってるか最終チェック（揃ってなければ voting に戻す）
          const missing = expectedIds.filter((id) => !ballotMap[id]);

          if (missing.length > 0) {
            console.warn("ballotsが未収集の参加者があります。finalizing解除して戻します:", missing);

            await setDoc(sessionDocRef, { phase: "voting", updatedAt: serverTimestamp() }, { merge: true });
            await setDoc(
              doc(db, "rooms", roomId, "play3State", "state"),
              { phase: "voting", updatedAt: serverTimestamp() },
              { merge: true }
            );
            return;
          }

          // 4) 集計
          const finalVotes: VoteChoice[] = expectedIds.map((id) => ballotMap[id]);

          const goVotes = finalVotes.filter((v) => v === "go").length;
          const noVotes = finalVotes.filter((v) => v === "no").length;
          const pendingVotes = finalVotes.filter((v) => v === "pending").length;

          // 5) 結果判定（全員一致のみ go/no。それ以外は必ずVS）
          const totalVotes = expectedIds.length;
          const isAllGo = goVotes === totalVotes && noVotes === 0 && pendingVotes === 0;
          const isAllNo = noVotes === totalVotes && goVotes === 0 && pendingVotes === 0;
          const finalStatus: "go" | "no" | "vs" | "neutral" = isAllGo ? "go" : isAllNo ? "no" : "vs";

          // 6) assignments / state / session を確定書き込み（終了時に roundCompleted を確定！）
          const assignmentRef = doc(db, "rooms", roomId, "play3Assignments", cardId);
          const stateRef = doc(db, "rooms", roomId, "play3State", "state");

          await runTransaction(db, async (tx) => {
            const aSnap = await tx.get(assignmentRef);
            const aData = aSnap.exists() ? (aSnap.data() as any) : {};

            const prevCompleted = Number(aData.roundCompleted ?? aData.round ?? 0);
            const activeRound = Number(aData.activeRound ?? activeVote?.round ?? (prevCompleted + 1));
            const newCompleted = Math.max(prevCompleted + 1, activeRound);

            // session finished
            tx.set(sessionDocRef, {
              phase: "finished" as VotePhase,
              finalizedAt: Date.now(),
              updatedAt: serverTimestamp(),
            }, { merge: true });

            // ✅ assignments：終了時に roundCompleted を +1（ここがあなたの必須条件）
            tx.set(assignmentRef, {
              status: finalStatus,
              pending: finalStatus === "vs",
              voteResult: { go: goVotes, no: noVotes, pending: pendingVotes },
              voteCompleted: true,

              roundCompleted: newCompleted,
              activeRound: null,
              activeSessionId: null,

              // 互換のため legacy round を残すなら、確定roundと同期
              round: newCompleted,

              updatedAt: serverTimestamp(),
              updatedBy: userName || "unknown",
            }, { merge: true });

            // state idle
            tx.set(stateRef, {
              phase: "idle" as VotePhase,
              cardId: null,
              sessionId: null,
              round: null,
              expectedUserIds: [],
              modalOpen: false,
              updatedAt: serverTimestamp(),
            }, { merge: true });
          });

          // 投票結果メッセージ生成（後方互換）
          const cardInfo = getCard(cardId);
          const cardName = cardInfo?.title || cardId;
          let resultMessage: string;
          let resultMessageJSX: React.ReactNode;
          
          if (finalStatus === "go") {
            resultMessage = `${cardName}は行くに移動しました！`;
            resultMessageJSX = resultMessage;
          } else if (finalStatus === "no") {
            resultMessage = `${cardName}は行かないに移動しました！`;
            resultMessageJSX = resultMessage;
          } else {
            resultMessage = `投票が終了しました！コンフリクトが発生したため、${cardName}はVSに移動しました。もう一度議論を行い、投票を行いましょう。`;
            resultMessageJSX = (
              <div style={{ lineHeight: 1.6 }}>
                <div>投票が終了しました！</div>
                <div>コンフリクトが発生したため、{cardName}はVSに移動しました。</div>
                <div style={{ 
                  borderTop: '2px solid #f59e0b', 
                  paddingTop: 8, 
                  marginTop: 8,
                  fontWeight: 600,
                  color: '#f59e0b'
                }}>
                  もう一度議論を行い、投票を行いましょう。
                </div>
              </div>
            );
          }
          
          // play3VoteResults に結果保存（履歴用）
          const resultId = `${cardId}_${sessionId}`;
          await setDoc(
            doc(db, "rooms", roomId, PLAY3_VOTE_RESULTS, resultId),
            {
              cardId: cardId,
              cardName: cardInfo?.title || cardId,
              sessionId: sessionId,
              round: activeVote?.round || 1,
              startedBy: sessionData.startedBy || "unknown",
              startedByName: sessionData.startedByName || "unknown",
              participants: expectedIds.map((id) => {
                const found = displayParticipants.find((p) => p.id === id);
                return {
                  id,
                  name: found?.name || "unknown",
                  vote: ballotMap[id] || "no-vote",
                };
              }),
              result: {
                status: finalStatus,
                goVotes,
                noVotes,
                pendingVotes,
              },
              timestamp: serverTimestamp(),
              completedAt: Date.now(),
            }
          );
          
          // play3State に投票結果を全員に通知（新メッセージフォーマット）
          await setDoc(
            doc(db, "rooms", roomId, "play3State", "state"),
            {
              voteResult: {
                cardId: cardId,
                cardName: cardName,
                message: resultMessage,
                status: finalStatus,
                timestamp: Date.now(),
              },
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          
          console.log('投票完了 - 結果保存完了:', { cardId, status: finalStatus, message: resultMessage });
          
          // 実験用：投票終了時刻を記録（全員投票完了時点）
          if (baseTimestamp) {
            const now = Date.now();
            const elapsed = now - baseTimestamp;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            const ms = elapsed % 1000;
            
            await setDoc(
              doc(db, "rooms", roomId, "play3Timing", `vote_end_${sessionId}`),
              {
                event: "vote_end",
                sessionId: sessionId,
                cardId: cardId,
                cardName: cardName,
                round: activeVote?.round || 1,
                timestamp: now,
                baseTimestamp,
                elapsedMs: elapsed,
                elapsedFormatted: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(ms).padStart(3, '0')}`,
                result: {
                  status: finalStatus,
                  goVotes,
                  noVotes,
                  pendingVotes,
                },
                participantCount: expectedIds.length,
              },
              { merge: true }
            ).catch(e => console.error("投票終了時刻記録エラー:", e));
          }
          
          // 0.7秒待ってからUI解除とモーダルを閉じる
          await new Promise(resolve => setTimeout(resolve, 700));
          
          // 7) UI解除（0.7秒後に実行）
          setUiLocked(false);
          setUiLockReason(null);
          
        } catch (e) {
          console.error("投票集計中にエラー:", e);
        } finally {
          setMyVoteChoice(null);
          setVoteMap({});
          closeCard();
        }
      })();
    }
  }, [
    activeVote?.phase,
    activeVote?.cardId,
    activeVote?.round,
    activeVote?.sessionId,
    activeVote?.expectedUserIds,
    voteMap,
    displayParticipants,
    myVoteChoice,
    roomId,
    myUserId,
    userName,
  ]);

  // 実参加者に含まれないIDでは投票を開始できないようにする
  const isActualParticipant = useMemo(() => {
    return !!(myUserId && displayParticipants.some(p => p.id === myUserId));
  }, [myUserId, displayParticipants]);

  // 投票開始時のログをFirebaseに記録
  const logVoteStart = async (cardId: string) => {
    if (!roomId || typeof roomId !== "string" || !myUserId) return;
    
    try {
      const cardInfo = getCard(cardId);
      const cardName = cardInfo?.title || cardId;
      
      const now = Date.now();
      const logRef = doc(db, "rooms", roomId, "play3VoteLogs", `start_${cardId}_${now}`);
      
      await setDoc(logRef, {
        event: "discussion_started",
        cardId,
        cardName,
        startedBy: myUserId,
        startedByName: normalizedUserName || userName || "unknown",
        timestamp: serverTimestamp(),
        participants: displayParticipants.map(p => ({ id: p.id, name: p.name })),
      }, { merge: true });
    } catch (error) {
      console.error("投票開始ログ記録エラー:", error);
    }
  };

  const startVote = async (targetCardId?: string) => {
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
    
    // 参加者IDリスト（実参加者ベース）
    const participantIds = Array.from(
      new Set(
        displayParticipants
          .map((p) => p.id?.trim())
          .filter((id): id is string => !!id && id.length > 0)
      )
    );
    const trimmedSelf = effectiveUserId?.trim();
    if (trimmedSelf && !participantIds.includes(trimmedSelf)) {
      participantIds.push(trimmedSelf);
    }
    
    try {
      // Transactionで既存セッション確認 & 新規セッション開始の排他制御
      const result = await runTransaction(db, async (transaction) => {
        const stateRef = doc(db, "rooms", roomId, "play3State", "state");
        const stateSnap = await transaction.get(stateRef);
        const stateData = stateSnap.data() as any;
        
        // 後方互換性: phase ?? modalOpen
        const currentPhase: VotePhase = stateData?.phase || (stateData?.modalOpen ? "voting" : "idle");
        
        // 既に投票中の場合 → 既存セッションへの参加を許可（投票は後でcastVoteで実施）
        if (currentPhase === "voting" && stateData?.cardId === cid && stateData?.sessionId) {
          console.log("既存セッションに参加:", stateData.sessionId);
          return { action: "join" as const, sessionId: stateData.sessionId };
        }
        
        // 他のカードで投票中
        if ((currentPhase === "voting" || currentPhase === "finalizing") && stateData?.cardId !== cid) {
          console.log("他のカードで投票中");
          throw new Error("blocked");
        }
        
        // finalizing状態なら新規投票不可
        if (currentPhase === "finalizing") {
          console.log("集計中");
          throw new Error("blocked");
        }
        
        // 投票完了状態確認 & round取得
        const assignmentRef = doc(db, "rooms", roomId, "play3Assignments", cid);
        const assignmentSnap = await transaction.get(assignmentRef);

        let completedRound = 0;
        let isVs = false;

        if (assignmentSnap.exists()) {
          const assignmentData = assignmentSnap.data();

          // ✅ 確定済みroundの正本（移行期間は legacy round も読む）
          completedRound = Number(
            assignmentData.roundCompleted ?? assignmentData.round ?? 0
          );

          isVs = assignmentData.status === "vs" || assignmentData.pending === true;

          // 投票完了済みカードでも再投票を許可（制限を削除）
          // 以前は: if (assignmentData.voteCompleted && !isVs) { throw new Error("completed"); }

          // 進行中セッションがあるなら join（同カード想定）
          if (assignmentData.activeSessionId) {
            const activeSessionId = assignmentData.activeSessionId as string;
            const sessionRef = doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, activeSessionId);
            const sessionSnap = await transaction.get(sessionRef);
            const sData = sessionSnap.exists() ? (sessionSnap.data() as any) : null;

            if (
              sData &&
              (sData.phase === "voting" || sData.phase === "finalizing") &&
              sData.cardId === cid
            ) {
              // play3Stateを最新セッションに合わせて更新し、join
              transaction.set(
                stateRef,
                {
                  phase: sData.phase,
                  cardId: cid,
                  sessionId: activeSessionId,
                  round: sData.round ?? assignmentData.activeRound ?? null,
                  expectedUserIds: sData.expectedUserIds ?? [],
                  modalOpen: true,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );

              return { action: "join" as const, sessionId: activeSessionId };
            }
          }
        }

        // ✅ 新規セッション開始：roundは「確定済み + 1」だが、確定は"終了時"に行う
        const newRound = completedRound + 1;
        const now = Date.now();
        const sessionId = `${cid}-r${newRound}-${now}`;

        console.log("新規セッション開始:", { sessionId, cid, newRound });

        // セッション作成
        const sessionRef = doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId);
        transaction.set(sessionRef, {
          cardId: cid,
          sessionId,
          phase: "voting" as VotePhase,
          round: newRound,
          expectedUserIds: participantIds,

          // ✅ votes:{ } は使わない（ballots正本）
          // votes: {},

          startedBy: effectiveUserId,
          startedByName: normalizedUserName || userName || "unknown",
          createdAt: now,
          updatedAt: serverTimestamp(),
        });
        
        // 実験用：投票開始時刻を記録（基準時刻からの経過時間）
        // トランザクション外で非同期記録するため、後で実行する必要がある（トランザクション内では記録できない）

        // play3State更新（phase: voting）
        transaction.set(
          stateRef,
          {
            phase: "voting" as VotePhase,
            cardId: cid,
            sessionId,
            round: newRound,
            expectedUserIds: participantIds,
            createdAt: now,
            updatedAt: serverTimestamp(),

            // 後方互換で残してOK（使ってるなら）
            modalOpen: true,
            initiatedById: effectiveUserId,
            initiatedByName: normalizedUserName || userName || "unknown",
          },
          { merge: true }
        );

        // ✅ assignments は「進行中round」だけ更新する（確定roundは触らない！）
        transaction.set(
          assignmentRef,
          {
            activeRound: newRound,
            activeSessionId: sessionId,
            voteCompleted: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        
        return { action: "started" as const, sessionId };
      });
      
      // Transaction成功後、ローカル状態更新
      setUiLocked(true);
      setUiLockReason("vote");
      
      console.log("startVote完了:", result);
      
      // 投票開始ログをFirebaseに記録
      if (result.action === "started") {
        await logVoteStart(cid);
      }
      
    } catch (error: any) {
      console.error("startVote transaction failed:", error);
      if (error.message?.includes("blocked")) {
        alert("現在、別の投票が進行中です");
      }
      // 投票完了エラーメッセージを削除（再投票を許可）
      // 以前は: else if (error.message?.includes("completed")) { alert("この目的地は既に投票が完了しています"); }
    }
  };

  const castVote = async (choice: VoteChoice, overrideSessionId?: string) => {
    if (!roomId || typeof roomId !== "string" || !myUserId) return;

    const sessionId = overrideSessionId || activeVote?.sessionId;
    if (!sessionId) return;

    if (!isActualParticipant) {
      alert(
        "この端末のIDが部屋の参加者として認識されていません。\n右上の参加者名と一致する端末から投票してください。"
      );
      return;
    }

    // 楽観更新（UI）
    setMyVoteChoice(choice);
    setVoteMap((prev) => ({ ...prev, [myUserId]: choice }));

    // ballots/{userId} に確実に保存
    const ballotRef = doc(
      db,
      "rooms",
      roomId,
      PLAY3_VOTE_SESSIONS,
      sessionId,
      "ballots",
      myUserId
    );

    await setDoc(
      ballotRef,
      {
        userId: myUserId,
        userName: normalizedUserName || userName || "unknown",
        choice,
        votedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await setDoc(
      doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId),
      { updatedAt: serverTimestamp() },
      { merge: true }
    );
  };

  // Neutral 折りたたみ
  const [neutralOpen, setNeutralOpen] = useState(false);

  // エリア詳細表示
  const [areaDetailModal, setAreaDetailModal] = useState<{
    area: 'go' | 'no' | 'vs' | null;
  }>({ area: null });

  // カード拡大表示
  const [expandedCard, setExpandedCard] = useState<{
    id: string;
    flipped: boolean;
  } | null>(null);

  // カテゴリ詳細表示
  const [categoryDetail, setCategoryDetail] = useState<{
    userInfoId: string;
    category: 'veryWant' | 'want' | 'neutral' | 'dont' | 'veryDont' | null;
  }>({
    userInfoId: '',
    category: null,
  });

  // モーダルが開いているときは背景のスクロールを無効化
  useEffect(() => {
    const isAnyModalOpen = 
      activeUserInfo ||
      areaDetailModal.area ||
      expandedCard ||
      categoryDetail.category ||
      neutralOpen ||
      showEndConfirm ||
      showForceEndConfirm;

    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }

    return () => {
      document.body.style.overflow = 'auto';
    };
  }, [activeUserInfo, areaDetailModal.area, expandedCard, categoryDetail.category, neutralOpen, showEndConfirm, showForceEndConfirm]);

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingText}>読み込み中...</div>
      </div>
    );
  }

  // 整列済み ID
  const goSorted = sortByAgreement(goIds);
  const noSorted = sortByAgreement(noIds);
  const vsSorted = sortVsByAgreementAndNumber(vsIds); // VS: 合致率が低い順 → カード番号順
  const neuSorted = sortByAgreement(neutralIds);

  console.log("[Play3 Render]", {
    goCount: goSorted.length,
    noCount: noSorted.length,
    vsCount: vsSorted.length,
    neuCount: neuSorted.length,
    uiLocked,
    uiLockReason,
    canEndGame: vsSorted.length === 0 && goSorted.length === minStops && !uiLocked
  });

  // カード幅を固定
  const TILE_W = 200;

  const canNormalEnd =
    vsSorted.length === 0 &&
    goSorted.length === minStops &&
    !uiLocked &&
    !(play3Ready[myUserId] ? true : false);

  const startForceEndPress = () => {
    if (play3Ready[myUserId]) return;
    forceEndTriggeredRef.current = false;
    if (forceEndTimerRef.current) {
      clearTimeout(forceEndTimerRef.current);
      forceEndTimerRef.current = null;
    }
    forceEndTimerRef.current = setTimeout(() => {
      forceEndTriggeredRef.current = true;
      setShowForceEndConfirm(true);
    }, 3000);
  };

  const cancelForceEndPress = () => {
    if (forceEndTimerRef.current) {
      clearTimeout(forceEndTimerRef.current);
      forceEndTimerRef.current = null;
    }
  };

  return (
    <div
      className={`${styles.container} ${uiLocked && uiLockReason === "vote" ? styles.containerLocked : ""}`}
    >
      <div
        className={styles.scaleWrapper}
      >
        {/* ヘッダー行 */}
        <div className={styles.header}>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'inline-block',
                padding: '10px 14px',
                backgroundColor: '#fef3c7',
                color: '#92400e',
                border: '2px solid #f59e0b',
                borderRadius: '8px',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)',
                lineHeight: '1.5',
                minWidth: '280px',
              }}
            >
              <div style={{ marginBottom: '3px', fontSize: '0.85rem', color: '#78350f' }}>📋 条件 <span style={{ fontWeight: 'bold', color: '#d97706' }}>（話し合いフェーズ 4/4）</span></div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: (vsSorted.length === 0) ? '#065f46' : '#92400e'
                }}
              >
                <span>{(vsSorted.length === 0) ? '✅' : '⏳'}</span>
                <span>・「VS」のカードを0枚にしましょう！</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: (goSorted.length === minStops) ? '#065f46' : '#92400e'
                }}
              >
                <span>{(goSorted.length === minStops) ? '✅' : '⏳'}</span>
                <span>・「行く」が{minStops}枚になるように決めよう！</span>
              </div>
              <div style={{ marginTop: '5px', paddingTop: '5px', borderTop: '1px solid #fbbf24', fontSize: '0.7rem' }}>
                現在:
                <span style={{ marginLeft: 4, color: (goSorted.length === minStops) ? '#065f46' : '#dc2626' }}>行く {goIds.length}枚</span>
                <span style={{ marginLeft: 8, color: (vsSorted.length === 0) ? '#065f46' : '#dc2626' }}>/ VS {vsIds.length}枚</span>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
              {renderAvatars()}
              {/* 合致率表示を削除 */}
            </div>
          </div>
        </div>

        {/* スクロール可能コンテンツエリア */}
        <div className={styles.contentArea}>
          {/* 上段: 行く / 行かない */}
          <div className={styles.mainGrid}>
            {/* 行く */}
            <section
              className={styles.sectionGo}
              onClick={() => {
                console.log('[Play3] Section click: go');
                setAreaDetailModal({ area: 'go' });
              }}
            >
              <div 
                className={styles.sectionHeader}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[Play3] Header click: go');
                  setAreaDetailModal({ area: 'go' });
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className={styles.sectionTitleGo}>行く</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className={styles.sectionCountGo}>
                    {goSorted.length}
                  </div>
                  <div className={styles.sectionCountGo} style={{ fontSize: '1.2rem' }}>^</div>
                </div>
              </div>
            <div className={styles.cardContainer}>
              {goSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                const isVoteCompleted = voteCompletedIds.has(id);
                return (
                  <div
                    key={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      openCard(id);
                    }}
                    className={styles.cardTile}
                    style={{ 
                      width: TILE_W,
                      border: isVoteCompleted ? "4px solid #f59e0b" : undefined,
                      boxShadow: isVoteCompleted ? "0 0 16px rgba(245, 158, 11, 0.6)" : undefined,
                    }}
                  >
                    <div className={styles.cardImage}>
                      <img
                        src={info?.src}
                        alt={info?.title}
                      />
                    </div>
                    <div className={styles.cardInfo}>
                      <div className={styles.cardTitle}>
                        {info?.title}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 行かない */}
          <section
            className={styles.sectionNoGo}
            onClick={() => {
              console.log('[Play3] Section click: no');
              setAreaDetailModal({ area: 'no' });
            }}
          >
            <div 
              className={styles.sectionHeader}
              onClick={(e) => {
                e.stopPropagation();
                console.log('[Play3] Header click: no');
                setAreaDetailModal({ area: 'no' });
              }}
              style={{ cursor: 'pointer' }}
            >
              <div className={styles.sectionTitleNoGo}>行かない</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className={styles.sectionCountNoGo}>
                  {noSorted.length}
                </div>
                <div className={styles.sectionCountNoGo} style={{ fontSize: '1.2rem' }}>^</div>
              </div>
            </div>
            <div className={styles.cardContainer}>
              {noSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                const isVoteCompleted = voteCompletedIds.has(id);
                return (
                  <div
                    key={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      openCard(id);
                    }}
                    className={styles.cardTile}
                    style={{ 
                      width: TILE_W,
                      border: isVoteCompleted ? "4px solid #f59e0b" : "1px solid #475569",
                      boxShadow: isVoteCompleted ? "0 0 16px rgba(245, 158, 11, 0.6)" : undefined,
                    }}
                  >
                    <div className={styles.cardImage}>
                      <img
                        src={info?.src}
                        alt={info?.title}
                      />
                    </div>
                    <div className={styles.cardInfo}>
                      <div className={styles.cardTitle}>
                        {info?.title}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          </div>

          {/* 中央: 議論中（VS） */}
          <div className={styles.sectionWrapper}>
            <section
              className={styles.sectionVs}
              onClick={() => {
                console.log('[Play3] Section click: vs');
                setAreaDetailModal({ area: 'vs' });
              }}
            >
              <div 
                className={styles.sectionHeader}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[Play3] Header click: vs');
                  setAreaDetailModal({ area: 'vs' });
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className={styles.sectionTitleVs}>議論中（VS）</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className={styles.sectionCountVs}>{vsSorted.length}</div>
                  <div className={styles.sectionCountVs} style={{ fontSize: '1.2rem' }}>^</div>
                </div>
              </div>
            <div className={styles.cardContainer}>
              {vsSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                const hasBlackBorder = blackBorderIds.has(id);
                const isVoteCompleted = voteCompletedIds.has(id);
                
                // 投票完了済みかつ黒枠の場合はゴールドを優先、それ以外は黒枠を優先
                let borderStyle = "2px solid #e5e7eb";
                let shadowStyle = undefined;
                if (isVoteCompleted && hasBlackBorder) {
                  borderStyle = "6px solid #f59e0b";
                  shadowStyle = "0 0 16px rgba(245, 158, 11, 0.6)";
                } else if (hasBlackBorder) {
                  borderStyle = "6px solid #000";
                } else if (isVoteCompleted) {
                  borderStyle = "4px solid #f59e0b";
                  shadowStyle = "0 0 16px rgba(245, 158, 11, 0.6)";
                }
                
                return (
                  <div
                    key={id}
                    onClick={(e) => {
                      e.stopPropagation();
                      openCard(id);
                    }}
                    className={styles.cardTile}
                    style={{
                      width: TILE_W,
                      border: borderStyle,
                      boxShadow: shadowStyle,
                    }}
                  >
                    <div className={styles.cardImage}>
                      <img
                        src={info?.src}
                        alt={info?.title}
                      />
                    </div>
                    <div className={styles.cardInfo}>
                      <div className={styles.cardTitle}>
                        {info?.title}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

          {/* 下部: どちらでもいい（折りたたみ・モーダル表示） */}
          <div className={styles.sectionWrapper}>
            <section
              className={styles.sectionNeutral}
              onClick={() => {
                console.log('[Play3] Section click: neutral');
                setNeutralOpen(true);
              }}
            >
              <div
                className={styles.sectionNeutralHeader}
                onClick={(e) => {
                  e.stopPropagation();
                  console.log('[Play3] Header click: neutral');
                  setNeutralOpen(true);
                }}
              >
                <div className={styles.sectionTitleNeutral}>どちらでもいい</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className={styles.sectionCountNeutral}>{neuSorted.length}</div>
                  <div style={{ transform: neutralOpen ? "rotate(180deg)" : "rotate(0deg)", fontSize: '1.2rem', color: '#4b5563' }}>
                    ^
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
        {/* contentArea 終了 */}

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
                boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ヘッダー */}
              <div
                style={{
                  background: '#e5e7eb',
                  borderBottom: '2px solid #d1d5db',
                  padding: '20px 24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#4b5563' }}>
                    どちらでもいい
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#4b5563' }}>
                    {neuSorted.length}枚
                  </div>
                </div>
                <button
                  onClick={() => setNeutralOpen(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 28,
                    cursor: 'pointer',
                    color: '#4b5563',
                    padding: '0 8px',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
              
              {/* カード表示エリア - スクロール可能 */}
              <div
                style={{
                  flex: 1,
                  padding: '24px',
                  overflow: 'auto',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 16,
                  }}
                >
                {neuSorted.map((id) => {
                  const info = getCard(id);
                  const ag = agreementMap.get(id) || 0;
                  return (
                    <div
                      key={id}
                      onClick={() => {
                        openCard(id);
                      }}
                      style={{
                        cursor: 'pointer',
                        border: '1px solid #e5e7eb',
                        background: '#fff',
                        borderRadius: 12,
                        overflow: 'hidden',
                        transition: 'transform 0.2s, box-shadow 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateY(-4px)';
                        e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.15)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                        <img
                          src={info?.src}
                          alt={info?.title}
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                      </div>
                      <div
                        style={{
                          padding: '12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ fontWeight: 800, color: '#111827', fontSize: 14 }}>
                          {info?.title}
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>

            </div>
          </div>
        )}

        {/* 参加者情報モーダル */}
        {activeUserInfo &&
          (() => {
            console.log('[Play3] Modal opened for:', {
              activeUserInfo,
              allSelections: selections.map(s => ({ 
                userId: s.userId, 
                user: s.user, 
                userName: s.userName,
                veryWantCount: s.categories?.veryWant?.length || 0,
                wantCount: s.categories?.want?.length || 0,
                neutralCount: s.categories?.neutral?.length || 0,
                dontCount: s.categories?.dont?.length || 0,
                veryDontCount: s.categories?.veryDont?.length || 0,
              })),
              displayParticipants: displayParticipants.map(p => ({ id: p.id, name: p.name }))
            });
            
            // activeUserInfo と selections のマッチング
            // displayParticipants の id とマッチさせる
            const participant = displayParticipants.find(p => p.id === activeUserInfo);
            
            // selections から該当ユーザーを検索
            // userId, user, userName のいずれかで照合
            const user = selections.find((s) => {
              const matchById = s.userId === activeUserInfo;
              const matchByUser = s.user === activeUserInfo;
              const matchByName = participant && (s.userName === participant.name || s.user === participant.name);
              
              console.log('[Play3] Matching attempt:', {
                selectionUserId: s.userId,
                selectionUser: s.user,
                selectionUserName: s.userName,
                activeUserInfo,
                participantName: participant?.name,
                matchById,
                matchByUser,
                matchByName,
              });
              
              return matchById || matchByUser || matchByName;
            });
            
            const displayName = user?.userName || participant?.name || activeUserInfo;
            const displayPlanName = user?.planName || participant?.plan || "—";
            
            if (!user) {
              console.log('[Play3] User not found in selections:', {
                activeUserInfo,
                availableUserIds: selections.map(s => s.userId),
                availableUsers: selections.map(s => s.user),
                availableUserNames: selections.map(s => s.userName),
              });
              // ユーザーが見つからない場合でも基本的なモーダルを表示
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
                      {displayName}
                    </div>
                    <div style={{ color: "#374151", marginBottom: 10 }}>
                      プラン名：<strong style={{ color: "#000000" }}>
                        {displayPlanName}
                      </strong>
                    </div>
                    <div style={{ padding: 16, textAlign: "center", color: "#6b7280" }}>
                      このユーザーのカード情報がまだ読み込まれていません
                    </div>
                    <div style={{ textAlign: "center", marginTop: 12 }}>
                      <button
                        onClick={() => setActiveUserInfo(null)}
                        style={{
                          padding: "8px 24px",
                          border: "1px solid #d1d5db",
                          borderRadius: 8,
                          background: "#f3f4f6",
                          fontWeight: 700,
                          color: "#6b7280",
                          cursor: "pointer",
                        }}
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            
            console.log('[Play3] 参加者情報モーダル:', {
              activeUserInfo,
              participant,
              foundUser: { 
                userId: user.userId, 
                user: user.user, 
                userName: user.userName,
                categories: user.categories 
              },
              displayName,
              displayPlanName
            });
            
            const counts = {
              veryWant: user.categories.veryWant.length,
              want: user.categories.want.length,
              neutral: user.categories.neutral.length,
              dont: user.categories.dont.length,
              veryDont: user.categories.veryDont.length,
            };
            
            // カテゴリごとの色定義
            const categoryColors: Record<string, { bg: string; border: string; text: string }> = {
              veryWant: { bg: '#fecaca', border: '#fca5a5', text: '#7f1d1d' }, // 赤
              want: { bg: '#fce7f3', border: '#fbcfe8', text: '#9d174d' }, // ピンク
              neutral: { bg: '#e5e7eb', border: '#d1d5db', text: '#374151' }, // 灰色
              dont: { bg: '#bae6fd', border: '#93c5fd', text: '#0c4a6e' }, // 水色
              veryDont: { bg: '#93c5fd', border: '#60a5fa', text: '#1e3a8a' }, // 青色
            };
            
            const catOrder: Array<{ key: keyof typeof counts; label: string }> = [
              { key: "veryWant", label: "特に行きたい" },
              { key: "want", label: "行きたい" },
              { key: "neutral", label: "どちらでも" },
              { key: "dont", label: "行きたくない" },
              { key: "veryDont", label: "特に行きたくない" },
            ];
            
            // resultページと同じロジック: selectionsから直接カードリストを取得
            const getList = (k: keyof typeof counts) => {
              return user.categories[k] || [];
            };

            return (
              <>
                <div
                  className={styles.userModalOverlay}
                  onClick={() => setActiveUserInfo(null)}
                >
                  <div
                    className={styles.userModal}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
                      {displayName}
                    </div>
                    <div style={{ color: "#374151", marginBottom: 10 }}>
                      プラン名：<strong style={{ color: "#000000" }}>
                        {displayPlanName}
                      </strong>
                    </div>
                    <div className={styles.userModalContent}>
                      {catOrder.map(({ key, label }) => {
                        const list = getList(key);
                        const colors = categoryColors[key as string] || categoryColors.neutral;
                        
                        return (
                          <div
                            key={key}
                            onClick={() => {
                              console.log('[Play3] toggle category', { activeUserInfo, categoryKey: key });
                              if (list.length > 0) {
                                setCategoryDetail({
                                  userInfoId: activeUserInfo || '',
                                  category: key,
                                });
                              }
                            }}
                            className={styles.categoryRow}
                            style={{ 
                              border: `2px solid ${colors.border}`, 
                              background: colors.bg,
                              cursor: list.length > 0 ? "pointer" : "default",
                            }}
                          >
                            <div style={{ fontWeight: 700, color: colors.text }}>{label}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontWeight: 800, color: colors.text, fontSize: 16 }}>
                                {list.length}
                              </span>
                              {list.length > 0 && (
                                <span style={{ color: colors.text, fontSize: 16, lineHeight: 1 }}>^</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ textAlign: "center", marginTop: 12, flexShrink: 0 }}>
                      <button
                        onClick={() => {
                          setActiveUserInfo(null);
                          setCategoryDetail({ userInfoId: '', category: null });
                        }}
                        style={{
                          padding: "8px 24px",
                          border: "1px solid #d1d5db",
                          borderRadius: 8,
                          background: "#f3f4f6",
                          fontWeight: 700,
                          color: "#6b7280",
                          cursor: "pointer",
                        }}
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                </div>

                {/* カテゴリ詳細モーダル */}
                {categoryDetail.category && categoryDetail.userInfoId === activeUserInfo && (() => {
                  console.log('[Play3] Category detail modal rendering:', {
                    category: categoryDetail.category,
                    userInfoId: categoryDetail.userInfoId,
                    activeUserInfo,
                    shouldRender: categoryDetail.userInfoId === activeUserInfo,
                  });
                  const category = categoryDetail.category;
                  const catData = catOrder.find(c => c.key === category);
                  const list = getList(category);
                  const colors = categoryColors[category as string] || categoryColors.neutral;

                  return (
                    <div
                      style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(4px)',
                        zIndex: 450,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 20,
                      }}
                      onClick={() => setCategoryDetail({ userInfoId: '', category: null })}
                    >
                      <div
                        style={{
                          background: '#fff',
                          borderRadius: 16,
                          maxWidth: 900,
                          width: '95%',
                          maxHeight: '90vh',
                          overflow: 'hidden',
                          display: 'flex',
                          flexDirection: 'column',
                          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* ヘッダー */}
                        <div
                          style={{
                            background: colors.bg,
                            borderBottom: `2px solid ${colors.border}`,
                            padding: '20px 24px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div style={{ fontSize: 24, fontWeight: 900, color: colors.text }}>
                              {catData?.label}
                            </div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: colors.text }}>
                              {list.length}枚
                            </div>
                          </div>
                          <button
                            onClick={() => setCategoryDetail({ userInfoId: '', category: null })}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              fontSize: 28,
                              cursor: 'pointer',
                              color: colors.text,
                              padding: '0 8px',
                              lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        </div>

                        {/* カード一覧 */}
                        <div
                          style={{
                            flex: 1,
                            overflow: 'auto',
                            padding: 24,
                          }}
                        >
                          {list.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 16 }}>
                              カードがありません
                            </div>
                          ) : (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: 16,
                              }}
                            >
                              {list.map((cardData, idx) => {
                                const info = getCard(cardData.id);
                                const parsed = parseReason((cardData as any).reason);
                                const displayEmoji = parsed.emoji || "";
                                const displayText = parsed.text || "";

                                return (
                                  <div
                                    key={idx}
                                    onClick={() => setExpandedCard({ id: cardData.id, flipped: false })}
                                    style={{
                                      cursor: 'pointer',
                                      border: '1px solid #e5e7eb',
                                      background: '#fff',
                                      borderRadius: 12,
                                      overflow: 'hidden',
                                      transition: 'transform 0.2s, box-shadow 0.2s',
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.transform = 'translateY(-4px)';
                                      e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.transform = 'translateY(0)';
                                      e.currentTarget.style.boxShadow = 'none';
                                    }}
                                  >
                                    <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                                      <img
                                        src={info?.src}
                                        alt={info?.title}
                                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                      />
                                    </div>
                                    <div style={{ padding: '12px' }}>
                                      <div style={{ fontWeight: 800, color: '#111827', fontSize: 14, marginBottom: 6 }}>
                                        {info?.title}
                                      </div>
                                      {(displayEmoji || displayText) && (
                                        <div style={{ 
                                          fontSize: 13, 
                                          color: '#374151', 
                                          fontWeight: 600,
                                          lineHeight: 1.5,
                                          background: '#f9fafb',
                                          padding: '6px 8px',
                                          borderRadius: 6,
                                          border: '1px solid #e5e7eb',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}>
                                          {displayEmoji && (
                                            <span style={{ fontSize: 16, flexShrink: 0 }}>
                                              {displayEmoji}
                                            </span>
                                          )}
                                          {displayText && (
                                            <span style={{ flex: 1 }}>
                                              {displayText}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            );
          })()}

        {/* カード詳細モーダル */}
        {cardModal && !voteResultModal &&
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
                  background: isCardModalMinimized ? "transparent" : "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: isCardModalMinimized ? "flex-end" : "center",
                  justifyContent: isCardModalMinimized ? "flex-start" : "center",
                  padding: isCardModalMinimized ? 16 : 0,
                  zIndex: 120,
                  pointerEvents: isCardModalMinimized ? "none" : "auto",
                }}
                onClick={() => {
                  // 最小化中は何もしない
                  if (isCardModalMinimized) return;
                  
                  // 投票中の場合は閉じる（投票小ウィンドウに戻る）
                  if (activeVote?.phase === "voting" || activeVote?.phase === "finalizing") {
                    closeCard();
                    return;
                  }
                  
                  // 投票済みの場合は外クリックで閉じられない
                  if (myVoteChoice) return;
                  
                  closeCard();
                }}
              >
                <div
                  style={{
                    width: isCardModalMinimized ? 360 : "min(92vw, 760px)",
                    background: "#fff",
                    borderRadius: 12,
                    overflow: "hidden",
                    boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
                    pointerEvents: "auto",
                    zIndex: isCardModalMinimized ? 110 : 130,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 最小化ヘッダー */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 12px",
                      borderBottom: "1px solid #e5e7eb",
                      background: "#fff",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, color: "#111827", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {info?.title}
                        {isCardModalMinimized ? "（参照中）" : ""}
                      </div>
                      {(activeVote?.phase === "voting" || activeVote?.phase === "finalizing") && (
                        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 700, marginTop: 2 }}>
                          投票ウィンドウ
                        </div>
                      )}
                    </div>
                    {/* 小ウィンドウ化ボタン：投票中かつ投票カードの場合のみ表示 */}
                    {(activeVote?.phase === "voting" || activeVote?.phase === "finalizing") && votingCardId === cardModal.id && (
                    <button
                      type="button"
                      onClick={() => setIsCardModalMinimized((v) => !v)}
                      style={{
                        flexShrink: 0,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        fontWeight: 900,
                        color: "#111827",
                        cursor: "pointer",
                      }}
                    >
                      {isCardModalMinimized ? "元に戻す" : "小ウィンドウ化"}
                    </button>
                    )}
                  </div>

                  {/* 最小化時の投票ボタンエリア */}
                  {isCardModalMinimized && (
                    <div
                      style={{
                        borderBottom: "1px solid #e5e7eb",
                        padding: "12px 16px",
                        background: "#f9fafb",
                        display: "flex",
                        gap: 8,
                        flexDirection: "column",
                      }}
                    >
                      {(() => {
                        const cid = cardModal?.id;
                        if (!cid) return null;

                        const isVoting = activeVote?.phase === "voting" || activeVote?.phase === "finalizing";
                        const myChoice = myVoteChoice || voteMap[myUserId];
                        const hasVoted = !!myChoice;

                        // 投票中は投票ボタンを表示
                        if (isVoting) {
                          const votedNo = myChoice === "no";
                          const votedGo = myChoice === "go";
                          const votedPending = myChoice === "pending";

                          const handleVoteClickMinimized = async (vote: VoteChoice) => {
                            if (hasVoted) return;
                            if (!activeVote?.sessionId) return;
                            await castVote(vote, activeVote.sessionId);
                          };

                          const createButtonStyle = (voted: boolean) => ({
                            padding: "10px 14px",
                            borderRadius: 10,
                            border: "none",
                            color: "#fff",
                            fontWeight: 900,
                            fontSize: 14,
                            opacity: hasVoted && !voted ? 0.6 : 1,
                            cursor: hasVoted && !voted ? "not-allowed" : "pointer",
                            transition: "all .12s ease",
                          });

                          return (
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                disabled={hasVoted && !votedNo}
                                onClick={() => handleVoteClickMinimized("no")}
                                style={{
                                  ...createButtonStyle(votedNo),
                                  background: votedNo ? "#1e40af" : "#60a5fa",
                                  boxShadow: votedNo ? "0 0 0 3px rgba(96,165,250,0.35) inset" : undefined,
                                  transform: votedNo ? "translateY(1px)" : undefined,
                                }}
                              >
                                行かない
                              </button>
                              <button
                                disabled={hasVoted && !votedPending}
                                onClick={() => handleVoteClickMinimized("pending")}
                                style={{
                                  ...createButtonStyle(votedPending),
                                  background: votedPending ? "#ca8a04" : "#fef08a",
                                  color: votedPending ? "#fff" : "#713f12",
                                  boxShadow: votedPending ? "0 0 0 3px rgba(254,240,138,0.35) inset" : undefined,
                                  transform: votedPending ? "translateY(1px)" : undefined,
                                }}
                              >
                                保留
                              </button>
                              <button
                                disabled={hasVoted && !votedGo}
                                onClick={() => handleVoteClickMinimized("go")}
                                style={{
                                  ...createButtonStyle(votedGo),
                                  background: votedGo ? "#db2777" : "#f9a8d4",
                                  boxShadow: votedGo ? "0 0 0 3px rgba(249,168,212,0.35) inset" : undefined,
                                  transform: votedGo ? "translateY(1px)" : undefined,
                                }}
                              >
                                行く
                              </button>
                            </div>
                          );
                        }

                        // 投票中でない場合（小ウィンドウ）は「議論開始」UIを表示しない
                        return null;
                      })()}
                    </div>
                  )}

                  <div
                    style={{
                      display: isCardModalMinimized ? "none" : "flex",
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
                        onClick={() => setExpandedCard({ id: cardModal.id, flipped: false })}
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
                          src={info?.src}
                          alt={info?.title}
                          style={{ width: "100%", height: "100%", objectFit: "contain" }}
                        />
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "#111827" }}>
                        {info?.title}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 900, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>各ユーザーの選択（1人フェーズ時点）</span>
                        {voteCompletedIds.has(cardModal.id) && (
                          <div style={{
                            background: '#f59e0b',
                            color: '#fff',
                            padding: '4px 12px',
                            borderRadius: 9999,
                            fontSize: 13,
                            fontWeight: 800,
                            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.5)',
                          }}>
                            議論終了済み
                          </div>
                        )}
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
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                {(() => {
                                  const { emoji, text } = parseReason(u.reason);
                                  return (
                                    <>
                                      {emoji && (
                                        <span style={{ fontSize: 16 }}>{emoji}</span>
                                      )}
                                      <span>
                                        {text && text.trim() ? text : "（なし）"}
                                      </span>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 投票ボタンエリア */}
                  {!isCardModalMinimized && (
                  <div
                    style={{
                      borderTop: "1px solid #e5e7eb",
                      padding: "16px 20px",
                      background: "#f9fafb",
                    }}
                  >
                    <div style={{
                      display: "flex",
                      gap: 12,
                      justifyContent: "center",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}>
                      {(() => {
                        // 投票小ウィンドウ以外のカードは投票を無効化
                        const isMinimizedCard = activeVote?.cardId === cardModal.id;
                        const isVotingDisabled = !isMinimizedCard && (activeVote?.phase === "voting" || activeVote?.phase === "finalizing");

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
                          background: isVotingDisabled ? "#6b7280" : (votedNo ? "#1e40af" : "#60a5fa"), // 投票不可時は黒塗り
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedNo
                            ? "0 0 0 3px rgba(96,165,250,0.35) inset"
                            : undefined,
                          transform: votedNo ? "translateY(1px)" : undefined,
                          transition: "all .12s ease",
                          opacity: isVotingDisabled ? 0.6 : (hasVoted && !votedNo ? 0.6 : 1),
                          cursor: isVotingDisabled ? "not-allowed" : (hasVoted && !votedNo ? "not-allowed" : "pointer"),
                        };
                        const goStyle: any = {
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: isVotingDisabled ? "#6b7280" : (votedGo ? "#db2777" : "#f9a8d4"), // 投票不可時は黒塗り
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedGo
                            ? "0 0 0 3px rgba(249,168,212,0.35) inset"
                            : undefined,
                          transform: votedGo ? "translateY(1px)" : undefined,
                          transition: "all .12s ease",
                          opacity: isVotingDisabled ? 0.6 : (hasVoted && !votedGo ? 0.6 : 1),
                          cursor: isVotingDisabled ? "not-allowed" : (hasVoted && !votedGo ? "not-allowed" : "pointer"),
                        };
                        const pendingStyle: any = {
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: isVotingDisabled ? "#6b7280" : (votedPending ? "#ca8a04" : "#fef08a"), // 投票不可時は黒塗り
                          color: isVotingDisabled ? "#fff" : (votedPending ? "#fff" : "#713f12"),
                          fontWeight: 900,
                          boxShadow: votedPending
                            ? "0 0 0 3px rgba(254,240,138,0.35) inset"
                            : undefined,
                          transform: votedPending ? "translateY(1px)" : undefined,
                          transition: "all .12s ease",
                          opacity: isVotingDisabled ? 0.6 : (hasVoted && !votedPending ? 0.6 : 1),
                          cursor: isVotingDisabled ? "not-allowed" : (hasVoted && !votedPending ? "not-allowed" : "pointer"),
                        };

                        // 「投票済み x/y」をexpectedVoteIdsベースで計算（セッション参加者が真実源）
                        const totalParticipantsCount = expectedVoteIds.length;
                        const votedCount = expectedVoteIds.reduce((acc, id) => {
                          const v = voteMap[id];
                          const mine = id === myUserId ? (myVoteChoice || v) : v;
                          return acc + (mine ? 1 : 0);
                        }, 0);

                        console.log('Vote progress calculation:', {
                          expectedVoteIds,
                          totalParticipantsCount,
                          votedCount,
                          voteMap,
                          myUserId,
                          myVoteChoice
                        });

                        // 投票済みユーザーのリストを作成（投票順）
                        const votedUsers: Array<{ name: string; vote: VoteChoice; votedAt?: number }> = [];
                        expectedVoteIds.forEach((id) => {
                          const v = voteMap[id];
                          const mine = id === myUserId ? (myVoteChoice || v) : v;
                          if (mine) {
                            const participant = displayParticipants.find(p => p.id === id);
                            const name = participant?.name || id;
                            votedUsers.push({ name, vote: mine, votedAt: 0 });
                          }
                        });

                        return (
                          <>
                            {/* 投票開始メッセージ */}
                            {!isCardModalMinimized && (activeVote?.phase === "voting" || activeVote?.phase === "finalizing") && (
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

                            {/* 黒枠カードでも常に投票ボタンを表示（投票すると黒枠が解除される） */}
                            {(() => {
                              // カードのステータスを確認
                              const isVs = vsIds.includes(cardModal.id);
                              const hasBlackBorder = blackBorderIds.has(cardModal.id);
                              
                              // 黒枠カードの場合、状況を通知するメッセージを表示
                              const showWarning = hasBlackBorder && isVs;

                              const isVoting = activeVote?.phase === "voting" || activeVote?.phase === "finalizing";

                              const handleVoteClick = async (vote: VoteChoice) => {
                                const cid = cardModal?.id;
                                if (!cid) return;
                                // 投票小ウィンドウ以外では投票不可
                                if (isVotingDisabled) return;
                                // 参照のために最小化している間は、投票はできない
                                if (isCardModalMinimized) return;
                                if (hasVoted) return;

                                console.log('vote click', {
                                  vote,
                                  hasVoted,
                                  activeSessionId: activeVote?.sessionId,
                                  activeCardId: activeVote?.cardId,
                                  activePhase: activeVote?.phase,
                                  modalCardId: cid,
                                });

                                // 投票中の場合のみボタンが機能
                                if (!isVoting) return;

                                // すでに同カードで投票中なら開始せずに投票だけ行う
                                if (
                                  activeVote?.phase === "voting" &&
                                  activeVote?.sessionId &&
                                  activeVote?.cardId === cid
                                ) {
                                  await castVote(vote, activeVote.sessionId);
                                  return;
                                }
                              };

                              const handleStartDiscussion = async () => {
                                const cid = cardModal?.id;
                                if (!cid) return;
                                await startVote(cid);
                              };
                              
                              // 投票ボタンを表示
                              return (
                              <>
                                {showWarning && (
                                  <div
                                    style={{
                                      padding: "12px 16px",
                                      borderRadius: 8,
                                      background: "#fef3c7",
                                      border: "1px solid #f59e0b",
                                      color: "#92400e",
                                      fontWeight: 700,
                                      textAlign: "center",
                                      fontSize: 12,
                                      marginBottom: 8,
                                    }}
                                  >
                                    前回は意見が分かれました。もう一度投票できます
                                  </div>
                                )}

                                {/* 投票中は投票ボタンを表示、投票前は議論開始ボタンを表示 */}
                                {isVoting ? (
                                  <>
                                    <div style={{ position: "relative" }}>
                                      <button
                                        aria-pressed={votedNo}
                                        disabled={isCardModalMinimized || (hasVoted && !votedNo)}
                                        onClick={() => handleVoteClick("no")}
                                        style={noStyle}
                                      >
                                        行かない
                                      </button>
                                    </div>

                                    <div style={{ position: "relative" }}>
                                      <button
                                        aria-pressed={votedPending}
                                        disabled={isCardModalMinimized || (hasVoted && !votedPending)}
                                        onClick={() => handleVoteClick("pending")}
                                        style={pendingStyle}
                                      >
                                        保留
                                      </button>
                                    </div>

                                    <div style={{ position: "relative" }}>
                                      <button
                                        aria-pressed={votedGo}
                                        disabled={isCardModalMinimized || (hasVoted && !votedGo)}
                                        onClick={() => handleVoteClick("go")}
                                        style={goStyle}
                                      >
                                        行く
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <button
                                    onClick={handleStartDiscussion}
                                    style={{
                                      padding: "12px 16px",
                                      borderRadius: 10,
                                      border: "none",
                                      background: "#059669",
                                      color: "#fff",
                                      fontWeight: 900,
                                      fontSize: 14,
                                      cursor: "pointer",
                                      transition: "all .12s ease",
                                    }}
                                  >
                                    議論開始
                                  </button>
                                )}
                            </>
                            );
                            })()}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  )}

                  {/* 投票状況表示エリア */}
                  {(() => {
                    const myChoice = myVoteChoice || voteMap[myUserId];
                    const totalParticipantsCount = expectedVoteIds.length;
                    const votedCount = expectedVoteIds.reduce((acc, id) => {
                      const v = voteMap[id];
                      const mine = id === myUserId ? (myVoteChoice || v) : v;
                      return acc + (mine ? 1 : 0);
                    }, 0);

                    const isVotingNow =
                      !!activeVote?.sessionId &&
                      (activeVote?.phase === "voting" || activeVote?.phase === "finalizing") &&
                      activeVote?.cardId === cardModal.id;

                    if (!isVotingNow) return null;

                    // 最小化中は、背景参照を優先して投票状況パネルは表示しない
                    if (isCardModalMinimized) return null;

                    // 投票済みユーザーのリスト
                    const votedUsers: Array<{ name: string; vote: VoteChoice }> = [];
                    expectedVoteIds.forEach((id) => {
                      const v = voteMap[id];
                      const mine = id === myUserId ? (myVoteChoice || v) : v;
                      if (mine) {
                        const participant = displayParticipants.find(p => p.id === id);
                        const name = participant?.name || id;
                        votedUsers.push({ name, vote: mine });
                      }
                    });

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

                    const getChoiceFor = (id: string): VoteChoice | null => {
                      const v = voteMap[id];
                      const mine = id === myUserId ? (myVoteChoice || v) : v;
                      return mine || null;
                    };

                    const unvotedIds = expectedVoteIds.filter((id) => !getChoiceFor(id));
                    const maxCount = Math.max(goCount, noCount, pendingCount);

                    const renderNameChips = (ids: string[], bg: string, color: string) => {
                      if (ids.length === 0) {
                        return <span style={{ color: "#9ca3af", fontSize: 12 }}>なし</span>;
                      }
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {ids.map((id) => {
                            const info = participantMap.get(id);
                            const name = info?.name || id;
                            const isMe = id === myUserId;
                            return (
                              <span
                                key={id}
                                title={id}
                                style={{
                                  background: bg,
                                  color,
                                  fontSize: 12,
                                  fontWeight: isMe ? 900 : 700,
                                  padding: "4px 8px",
                                  borderRadius: 9999,
                                  border: isMe ? "2px solid rgba(239,68,68,0.55)" : "1px solid rgba(0,0,0,0.06)",
                                }}
                              >
                                {name}
                              </span>
                            );
                          })}
                        </div>
                      );
                    };

                    const goIdsNow = expectedVoteIds.filter((id) => getChoiceFor(id) === "go");
                    const noIdsNow = expectedVoteIds.filter((id) => getChoiceFor(id) === "no");
                    const pendingIdsNow = expectedVoteIds.filter((id) => getChoiceFor(id) === "pending");

                    return (
                      <div
                        style={{
                          borderTop: "1px solid #e5e7eb",
                          padding: "14px 20px 18px",
                          background: "#fff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 900, color: "#111827" }}>
                            投票状況 <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>({votedCount}/{totalParticipantsCount})</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                            {activeVote?.phase === "finalizing" ? "集計中…" : "投票中"}
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
                          <div
                            style={{
                              border: goCount === maxCount && maxCount > 0 ? "2px solid #db2777" : "1px solid #e5e7eb",
                              borderRadius: 12,
                              padding: 10,
                              background: "rgba(249,168,212,0.18)",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontWeight: 900, color: "#9d174d" }}>行く</div>
                              <div style={{ fontWeight: 900, color: "#9d174d" }}>{goCount}</div>
                            </div>
                            <div style={{ marginTop: 8 }}>{renderNameChips(goIdsNow, "#fce7f3", "#9d174d")}</div>
                          </div>

                          <div
                            style={{
                              border: noCount === maxCount && maxCount > 0 ? "2px solid #1e40af" : "1px solid #e5e7eb",
                              borderRadius: 12,
                              padding: 10,
                              background: "rgba(96,165,250,0.16)",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontWeight: 900, color: "#1e40af" }}>行かない</div>
                              <div style={{ fontWeight: 900, color: "#1e40af" }}>{noCount}</div>
                            </div>
                            <div style={{ marginTop: 8 }}>{renderNameChips(noIdsNow, "#dbeafe", "#1e40af")}</div>
                          </div>

                          <div
                            style={{
                              border: pendingCount === maxCount && maxCount > 0 ? "2px solid #ca8a04" : "1px solid #e5e7eb",
                              borderRadius: 12,
                              padding: 10,
                              background: "rgba(254,240,138,0.35)",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ fontWeight: 900, color: "#92400e" }}>保留</div>
                              <div style={{ fontWeight: 900, color: "#92400e" }}>{pendingCount}</div>
                            </div>
                            <div style={{ marginTop: 8 }}>{renderNameChips(pendingIdsNow, "#fef3c7", "#92400e")}</div>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                          未投票: {unvotedIds.length === 0 ? "なし" : unvotedIds.map((id) => participantMap.get(id)?.name || id).join("、")}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}

        {/* スティッキーフッター（終了） */}
      </div>

      <div className={styles.endButtonWrapper}>
        <button
          aria-disabled={!canNormalEnd}
          onPointerDown={startForceEndPress}
          onPointerUp={cancelForceEndPress}
          onPointerLeave={cancelForceEndPress}
          onPointerCancel={cancelForceEndPress}
          onClick={() => {
            // 長押しで強制終了モーダルが出た場合、clickは無視
            if (forceEndTriggeredRef.current) {
              forceEndTriggeredRef.current = false;
              return;
            }
            if (!roomId || typeof roomId !== "string" || !myUserId) return;
            if (!canNormalEnd) return;
            setShowEndConfirm(true);
          }}
          className={`${styles.endButton} ${canNormalEnd ? styles.endButtonEnabled : styles.endButtonDisabled}`}
          title={
            play3Ready[myUserId]
              ? "既に終了ボタンを押しました。結果ページへお進みください。"
              : canNormalEnd
              ? "クリックして終了し、結果ページに進む"
              : vsSorted.length > 0
              ? `VSカードが${vsSorted.length}枚残っています。先に決定してください。`
              : `「行く」カードが最低周遊数（${minStops}枚）に達していません。`
          }
        >
          終了して結果を見る
        </button>
      </div>

      {showEndConfirm && (
        <div className={styles.endConfirmOverlay}>
          <div className={styles.endConfirmModal}>
            <h2 className={styles.endConfirmTitle}>確認</h2>
            <p className={styles.endConfirmMessage}>
              終了して結果ページへ進みます。よろしいですか？
            </p>
            <div className={styles.endConfirmButtons}>
              <button
                onClick={async () => {
                  if (!roomId || typeof roomId !== "string" || !myUserId) return;
                  if (!canNormalEnd) {
                    setShowEndConfirm(false);
                    return;
                  }
                  console.log('終了ボタン確認: はい', {
                    roomId,
                    myUserId,
                    normalizedUserName,
                    vsSortedLength: vsSorted.length,
                    vsIds
                  });
                  await setDoc(
                    doc(db, "rooms", roomId, "play3Result", myUserId),
                    {
                      userId: myUserId,
                      userName: normalizedUserName || userName,
                      ready: true,
                      completed: true,
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                  setShowEndConfirm(false);
                  router.push(`/room/${roomId}/result`);
                }}
                className={styles.endConfirmYes}
              >
                はい
              </button>
              <button
                onClick={() => setShowEndConfirm(false)}
                className={styles.endConfirmNo}
              >
                いいえ
              </button>
            </div>
          </div>
        </div>
      )}

      {showForceEndConfirm && (
        <div className={styles.forceEndOverlay}>
          <div className={styles.forceEndModal}>
            <div className={styles.forceEndIcon} aria-hidden>
              ⚠️
            </div>
            <div className={styles.forceEndTitle}>強制終了</div>
            <div className={styles.forceEndMessage}>
              条件を満たしていない状態で
              <br />
              結果ページへ進みます。
              <br />
              よろしいですか？
            </div>
            <div className={styles.forceEndButtons}>
              <button
                className={styles.forceEndYes}
                onClick={async () => {
                  if (!roomId || typeof roomId !== "string" || !myUserId) {
                    setShowForceEndConfirm(false);
                    return;
                  }

                  await setDoc(
                    doc(db, "rooms", roomId, "play3Result", myUserId),
                    {
                      userId: myUserId,
                      userName: normalizedUserName || userName,
                      ready: true,
                      completed: true,
                      forced: true,
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                  setShowForceEndConfirm(false);
                  router.push(`/room/${roomId}/result`);
                }}
              >
                はい
              </button>
              <button
                className={styles.forceEndNo}
                onClick={() => setShowForceEndConfirm(false)}
              >
                いいえ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 終了後は待機せず result に遷移する */}

      {/* 投票結果表示モーダル */}
      {(() => {
        console.log('投票結果モーダル表示チェック:', { voteResultModal });
        return voteResultModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            zIndex: 300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 20,
              padding: "40px 32px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              maxWidth: 500,
              width: "90%",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 900,
                color: "#111827",
                marginBottom: 24,
                lineHeight: 1.6,
              }}
            >
              {(() => {
                const msg = voteResultModal.message;
                // VS移動メッセージの場合は改行と装飾を追加
                if (msg.includes('コンフリクトが発生したため')) {
                  const cardName = voteResultModal.cardName;
                  return (
                    <div style={{ lineHeight: 1.8 }}>
                      <div>投票が終了しました！</div>
                      <div>コンフリクトが発生したため、{cardName}はVSに移動しました。</div>
                      <div style={{ 
                        borderTop: '3px solid #f59e0b', 
                        paddingTop: 16, 
                        marginTop: 16,
                        fontWeight: 700,
                        color: '#f59e0b',
                        fontSize: 22
                      }}>
                        もう一度議論を行い、投票を行いましょう。
                      </div>
                    </div>
                  );
                }
                return msg;
              })()}
            </div>
            <button
              onClick={() => {
                // 自分の画面だけ閉じる（他のユーザーには影響させない）
                setVoteResultModal(null);
              }}
              style={{
                padding: "14px 32px",
                background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(59, 130, 246, 0.4)",
                transition: "all 0.2s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 16px rgba(59, 130, 246, 0.5)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(59, 130, 246, 0.4)";
              }}
            >
              閉じる
            </button>
          </div>
        </div>
        );
      })()}

      {/* エリア詳細モーダル */}
      {areaDetailModal.area && (() => {
        const areaConfig = {
          go: {
            title: '行く',
            cards: goSorted,
            bgColor: '#fee2e2',
            borderColor: '#fca5a5',
            textColor: '#7f1d1d',
          },
          no: {
            title: '行かない',
            cards: noSorted,
            bgColor: '#1e3a8a',
            borderColor: '#334155',
            textColor: '#fff',
          },
          vs: {
            title: '議論中（VS）',
            cards: vsSorted,
            bgColor: '#ffedd5',
            borderColor: '#fdba74',
            textColor: '#9a3412',
          },
        };
        
        const config = areaConfig[areaDetailModal.area];
        
        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              zIndex: 400,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
            onClick={() => setAreaDetailModal({ area: null })}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 16,
                maxWidth: 900,
                width: '95%',
                maxHeight: '90vh',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* ヘッダー */}
              <div
                style={{
                  background: config.bgColor,
                  borderBottom: `2px solid ${config.borderColor}`,
                  padding: '20px 24px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: config.textColor }}>
                    {config.title}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: config.textColor }}>
                    {config.cards.length}枚
                  </div>
                </div>
                <button
                  onClick={() => setAreaDetailModal({ area: null })}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 28,
                    cursor: 'pointer',
                    color: config.textColor,
                    padding: '0 8px',
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
              
              {/* カード一覧 */}
              <div
                style={{
                  flex: 1,
                  overflow: 'auto',
                  padding: 24,
                }}
              >
                {config.cards.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 16 }}>
                    カードがありません
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: 16,
                    }}
                  >
                    {config.cards.map((id) => {
                      const info = getCard(id);
                      const ag = agreementMap.get(id) || 0;
                      const hasBlackBorder = blackBorderIds.has(id);
                      
                      return (
                        <div
                          key={id}
                          onClick={() => {
                            setExpandedCard(null);
                            setCardModal({ id, flipped: false });
                            setAreaDetailModal({ area: null });
                          }}
                          style={{
                            cursor: 'pointer',
                            border: hasBlackBorder ? '4px solid #000' : '1px solid #e5e7eb',
                            background: '#fff',
                            borderRadius: 12,
                            overflow: 'hidden',
                            transition: 'transform 0.2s, box-shadow 0.2s',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-4px)';
                            e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.15)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                        >
                          <div style={{ width: '100%', aspectRatio: '3/2', background: '#fff' }}>
                            <img
                              src={info?.src}
                              alt={info?.title}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          </div>
                          <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 800, color: '#111827', fontSize: 14 }}>
                              {info?.title}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* カード拡大表示モーダル */}
      {expandedCard && (() => {
        const info = getCard(expandedCard.id);
        
        return (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.85)',
              zIndex: 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            onClick={() => setExpandedCard(null)}
          >
            <div
              style={{
                maxWidth: '90vw',
                maxHeight: '90vh',
                position: 'relative',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={
                  expandedCard.flipped
                    ? info?.backSrc
                    : info?.src
                }
                alt={info?.title}
                onClick={() => setExpandedCard({ ...expandedCard, flipped: !expandedCard.flipped })}
                style={{
                  maxWidth: '100%',
                  maxHeight: '90vh',
                  objectFit: 'contain',
                  borderRadius: '12px',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                  cursor: 'pointer',
                }}
              />
              {/* 回転ボタン */}
              <button
                onClick={() => setExpandedCard({ ...expandedCard, flipped: !expandedCard.flipped })}
                style={{
                  position: 'absolute',
                  bottom: '-16px',
                  right: '-16px',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#2563eb';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#3b82f6';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                title="カードを回転"
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2.5"
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                  style={{ width: '24px', height: '24px' }}
                >
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
              </button>
              {/* 閉じるボタン */}
              <button
                onClick={() => setExpandedCard(null)}
                style={{
                  position: 'absolute',
                  top: '-16px',
                  right: '-16px',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#dc2626';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#ef4444';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                title="閉じる"
              >
                ✕
              </button>
            </div>
          </div>
        );
      })()}

      <MapButton />

      {/* ノートウィンドウ */}
      <NoteWindow currentPage="play3" />
    </div>
  );
}
