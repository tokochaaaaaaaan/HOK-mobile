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
import styles from "./page.module.css";

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
  const cardTitles = [
    "ジョーズ",
    "アミティ・ボードウォーク・ゲーム",
    "ウォーターワールド",
    "ザ・ドラゴン・パール",
    "ロンバーズ・ランディング",
    "ロストワールド・レストラン",
    "ジュラシック・パーク・ダイナソー・ミート&グリート",
    "ザ・フライング・ダイナソー",
    "名探偵コナン 4-D ライブ・ショー ~星空の宝石(ジュエル)~",
    "クロミ・ライブ",
    "パークサイド・グリル",
    "SAIDO",
    "デリシャス・ミー！ザ・クッキー・キッチン",
    "スペース・キラー",
    "ミニオン・ハチャメチャ・アイス",
    "ミニオン・ハチャメチャ・ライド",
    "マリオカート ~クッパの挑戦状~",
    "ヨッシー・アドベンチャー",
    "キノピオカフェ",
    "ピットストップ・ポップコーン",
    "三本の箒",
    "オリバンダーの店",
    "ハリー・ポッター・アンド・ザ・フォービドゥン・ジャーニー",
    "フライト・オブ・ザ・ヒッポグリフ",
    "ハリウッド・ドリーム・ザ・ライド",
    "プレイング・ウィズおさるのジョージ",
    "シング・オン・ツアー",
    "スタジオ・スターズ・レストラン",
    "ビバリーヒルズ・ブランジェリー",
    "鬼滅の刃 XRライド ~刀鍛冶の里を疾走せよ~",
    "ハローキティのコーナーカフェ",
    "スヌーピー・バックロット・カフェ",
    "ハローキティのリボン・コレクション",
    "エルモのゴーゴー・スケートボード",
    "エルモのバブル・バブル",
    "エルモのリトル・ドライブ",
    "ハローキティのカップケーキ・ドリーム",
    "ビッグバードのビッグトップ・サーカス",
    "フライング・スヌーピー",
    "モッピーのバルーン・トリップ",
  ];

  const ALL_CARDS = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const idx = i + 1;
        return {
          id: `card${idx}`,
          title: cardTitles[i],
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

  // 参加者情報モーダル用
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
      router.push(`/room/${roomId}/result`);
    }
  }, [play3Ready, displayParticipants, vsIds.length, router, roomId]);


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

  // 初期自動配置（selectionsが更新されたら再計算）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    if (!assignLoaded) return;
    if (!selections.length) return;

    const byCard = (id: string) =>
      selections.map((s) => ({
        veryWant: s.categories.veryWant.some((c) => c.id === id),
        want: s.categories.want.some((c) => c.id === id),
        neutral: s.categories.neutral.some((c) => c.id === id),
        dont: s.categories.dont.some((c) => c.id === id),
        veryDont: s.categories.veryDont.some((c) => c.id === id),
      }));

    const initWrites = async () => {
      console.log('[Play3] カード振り分け開始:', { 
        selectionsCount: selections.length,
        allCardsCount: ALL_CARDS.length 
      });
      
      for (const card of ALL_CARDS) {
        const arr = byCard(card.id);
        
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
    selections,
    roomId,
    userName,
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
  const openCard = (id: string) => setCardModal({ id, flipped: false });
  const closeCard = () => setCardModal(null);
  const [uiLocked, setUiLocked] = useState(false);
  
  // 投票結果表示モーダル
  const [voteResultModal, setVoteResultModal] = useState<{ cardId: string; cardName: string; area: string } | null>(null);
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

  // 状態購読（全員へモーダル同期）
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
        
        const next: ActiveVoteState = {
          phase: inferredPhase,
          cardId: data.cardId || null,
          sessionId: data.sessionId || null,
          round: typeof data.round === "number" ? data.round : 0,
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
          setCardModal((m) => (m?.id === cid ? m : { id: cid, flipped: false }));
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
              area: data.voteResult.area,
            });
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
  }, [roomId, lastVoteResultTimestamp, voteResultModal]);

  // 投票状況購読（voting/finalizing phase のみ）
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const sessionId = activeVote?.sessionId;
    const phase = activeVote?.phase;
    
    // voting または finalizing フェーズのみ購読
    if (!sessionId || (phase !== "voting" && phase !== "finalizing")) {
      setVoteMap({});
      setMyVoteChoice(null);
      return;
    }
    
    const validIds = new Set(displayParticipants.map((p) => p.id));
    const unsub = onSnapshot(
      doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId),
      (snap) => {
        const data: any = snap.data();
        if (!data) {
          setVoteMap({});
          setMyVoteChoice(null);
          return;
        }
        
        const raw = data?.votes || {};
        const normalized: Record<string, VoteChoice> = {};
        
        // sessionベースではround解析不要、直接choice値を取得
        Object.entries(raw).forEach(([userId, choice]) => {
          const trimmed = typeof userId === "string" ? userId.trim() : "";
          if (!trimmed) return;
          
          // 参加者リストに含まれるIDのみ投票として認める
          if (validIds.has(trimmed)) {
            normalized[trimmed] = choice as VoteChoice;
          } else {
            console.log(`投票を除外: ${trimmed} (参加者リストに存在しない)`);
          }
        });
        
        const myServerChoice = normalized[myUserId];
        setVoteMap(() => {
          const merged: Record<string, VoteChoice> = { ...normalized };
          // 楽観更新された自分の投票が未反映なら追加
          if (!myServerChoice && myUserId && myVoteChoice && validIds.has(myUserId)) {
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
    activeVote?.sessionId,
    activeVote?.phase,
    activeVote?.round,
    displayParticipants,
    resolvedParticipantIds,
    myUserId,
    myVoteChoice,
  ]);

  // 全員投票完了で自動判定・クローズ（transactionベースのphaseロック）
  useEffect(() => {
    const phase = activeVote?.phase;
    if (phase !== "voting") return;
    
    const expectedIds = displayParticipants.map(p => p.id);
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
          
          // ロック獲得成功 - session docから最新投票を取得
          const sessionSnap = await getDoc(
            doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId)
          );
          
          if (!sessionSnap.exists()) {
            console.error('セッションドキュメントが見つかりません');
            return;
          }
          
          const sessionData = sessionSnap.data();
          const rawVotes = sessionData.votes || {};
          
          console.log('最新投票データ:', rawVotes);
          
          // 集計
          const finalVotes: VoteChoice[] = expectedIds
            .map((id) => rawVotes[id] as VoteChoice)
            .filter((v): v is VoteChoice => !!v);
          
          const allGo = finalVotes.every((v) => v === "go");
          const allNo = finalVotes.every((v) => v === "no");
          const goVotes = finalVotes.filter((v) => v === "go").length;
          const noVotes = finalVotes.filter((v) => v === "no").length;
          const pendingVotes = finalVotes.filter((v) => v === "pending").length;
          
          let finalStatus: string;
          let finalArea: string;
          const cardInfo = getCard(cardId);
          
          if (allGo) {
            finalStatus = "go";
            finalArea = "行く";
          } else if (allNo) {
            finalStatus = "no";
            finalArea = "行かない";
          } else {
            finalStatus = "vs";
            finalArea = "議論中";
          }
          
          // play3Assignments更新
          await setDoc(
            doc(db, "rooms", roomId, "play3Assignments", cardId),
            {
              status: finalStatus,
              pending: finalStatus === "vs",
              updatedAt: serverTimestamp(),
              updatedBy: userName || "unknown",
              voteResult: { go: goVotes, no: noVotes, pending: pendingVotes },
              hasBlackBorder: finalStatus === "vs",
              voteCompleted: true,
            },
            { merge: true }
          );
          
          // play3VoteResults に結果保存
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
              participants: displayParticipants.map(p => ({
                id: p.id,
                name: p.name || "unknown",
                vote: rawVotes[p.id] || "no-vote",
              })),
              result: {
                status: finalStatus,
                area: finalArea,
                goVotes,
                noVotes,
                pendingVotes,
              },
              timestamp: serverTimestamp(),
              completedAt: Date.now(),
            }
          );
          
          // play3VoteSessions を finished に更新
          await updateDoc(
            doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId),
            {
              phase: "finished" as VotePhase,
              resultRef: resultId,
              finalizedAt: Date.now(),
              updatedAt: serverTimestamp(),
            }
          );
          
          // play3State をクリア & 投票結果を全員に通知
          await setDoc(
            doc(db, "rooms", roomId, "play3State", "state"),
            {
              phase: "idle" as VotePhase,
              cardId: null,
              sessionId: null,
              round: null,
              expectedUserIds: [],
              voteResult: {
                cardId: cardId,
                cardName: cardInfo?.title || cardId,
                area: finalArea,
                timestamp: Date.now(),
              },
              updatedAt: serverTimestamp(),
              // 後方互換
              modalOpen: false,
              initiatedById: null,
              initiatedByName: null,
            },
            { merge: true }
          );
          
          console.log('投票完了 - 結果保存完了:', { cardId, area: finalArea });
          
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
        
        // 投票完了状態確認
        const assignmentRef = doc(db, "rooms", roomId, "play3Assignments", cid);
        const assignmentSnap = await transaction.get(assignmentRef);
        let isBlackBorder = false;
        if (assignmentSnap.exists()) {
          const assignmentData = assignmentSnap.data();
          isBlackBorder = assignmentData.hasBlackBorder === true;
          // 完了済みかつ黒枠でない → 開始不可
          if (assignmentData.voteCompleted && !isBlackBorder) {
            console.log("カードは投票完了済み（黒枠なし）");
            throw new Error("completed");
          }
          // 黒枠カード（VS）は再投票可能
        }
        
        // 新規セッション開始（idle状態 または 黒枠カードの再投票）
        const sessionId = `${cid}-${Date.now()}`;
        const now = Date.now();
        
        console.log("新規セッション開始:", { sessionId, isBlackBorder });
        
        // play3VoteSessionsに新規セッション作成（votes は空で開始、castVoteで投票を記録）
        const sessionRef = doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, sessionId);
        transaction.set(sessionRef, {
          cardId: cid,
          sessionId,
          phase: "voting" as VotePhase,
          round: 1,
          expectedUserIds: participantIds,
          votes: {},
          startedBy: effectiveUserId,
          startedByName: normalizedUserName || userName || "unknown",
          createdAt: now,
          updatedAt: serverTimestamp(),
        });
        
        // play3State更新（phase: voting）
        transaction.set(stateRef, {
          phase: "voting" as VotePhase,
          cardId: cid,
          sessionId,
          round: 1,
          expectedUserIds: participantIds,
          createdAt: now,
          updatedAt: serverTimestamp(),
          // 後方互換
          modalOpen: true,
          initiatedById: effectiveUserId,
          initiatedByName: normalizedUserName || userName || "unknown",
        }, { merge: true });
        
        // play3Assignments更新（投票中状態）
        transaction.set(assignmentRef, {
          hasBlackBorder: false,
          voteCompleted: false,
          updatedAt: serverTimestamp(),
        }, { merge: true });
        
        return { action: "started" as const, sessionId };
      });
      
      // Transaction成功後、ローカル状態更新
      setUiLocked(true);
      setUiLockReason("vote");
      
      console.log("startVote完了:", result);
      
      // 新規セッション作成時のみ、初回投票を実行
      if (result.action === "started") {
        setMyVoteChoice(choice);
        setVoteMap((prev) => ({
          ...prev,
          [effectiveUserId]: choice,
        }));
        
        // castVoteを呼び出して投票を記録
        await castVote(choice);
      }
      // 既存セッションに参加する場合は、castVoteを直接呼ぶ必要がある（ボタンから）
      
    } catch (error: any) {
      console.error("startVote transaction failed:", error);
      if (error.message?.includes("blocked")) {
        alert("現在、別の投票が進行中です");
      } else if (error.message?.includes("completed")) {
        alert("この目的地は既に投票が完了しています");
      }
    }
  };

  const castVote = async (choice: VoteChoice) => {
    if (
      !roomId ||
      typeof roomId !== "string" ||
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
    
    // play3VoteSessions/{sessionId} に直接投票を記録（roundエンコード不要）
    await setDoc(
      doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, activeVote.sessionId),
      {
        [`votes.${myUserId}`]: choice,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  // Neutral 折りたたみ
  const [neutralOpen, setNeutralOpen] = useState(false);

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
    canEndGame: vsSorted.length === 0 && !uiLocked
  });

  // 縮小時はカード幅も少し小さく
  const TILE_W = scale < 1 ? 180 : 220;

  return (
    <div
      className={`${styles.container} ${uiLocked && uiLockReason === "vote" ? styles.containerLocked : ""}`}
    >
      <div
        className={styles.scaleWrapper}
        style={{ transform: `scale(${scale})` }}
      >
        {/* ヘッダー行 */}
        <div className={styles.header}>
          <div className={styles.agreementRate}>
            合致率 {overallAgreement.toFixed(0)}%
          </div>
          {renderAvatars()}
        </div>

        {/* 開始メッセージ */}
        <div className={styles.startMessage}>
          カードを参照して、議論を行い、VSエリアのカードを0枚にしましょう！
        </div>

        {/* スクロール可能コンテンツエリア */}
        <div className={styles.contentArea}>
          {/* 上段: 行く / 行かない */}
          <div className={styles.mainGrid}>
            {/* 行く */}
            <section className={styles.sectionGo}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleGo}>行く</div>
                <div className={styles.sectionCountGo}>
                  {goSorted.length}
                </div>
              </div>
            <div className={styles.cardContainer}>
              {goSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                return (
                  <div
                    key={id}
                    onClick={() => openCard(id)}
                    className={styles.cardTile}
                    style={{ width: TILE_W }}
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
                      <div className={styles.cardAgreement}>
                        {ag.toFixed(0)}%
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 行かない */}
          <section className={styles.sectionNoGo}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitleNoGo}>行かない</div>
              <div className={styles.sectionCountNoGo}>
                {noSorted.length}
              </div>
            </div>
            <div className={styles.cardContainer}>
              {noSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                return (
                  <div
                    key={id}
                    onClick={() => openCard(id)}
                    className={styles.cardTile}
                    style={{ 
                      width: TILE_W,
                      border: "1px solid #475569",
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
                      <div className={styles.cardAgreement}>
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
          <div className={styles.sectionWrapper}>
            <section className={styles.sectionVs}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitleVs}>議論中（VS）</div>
                <div className={styles.sectionCountVs}>{vsSorted.length}</div>
              </div>
            <div className={styles.cardContainer}>
              {vsSorted.map((id) => {
                const info = getCard(id);
                const ag = agreementMap.get(id) || 0;
                const hasBlackBorder = blackBorderIds.has(id);
                return (
                  <div
                    key={id}
                    onClick={() => openCard(id)}
                    className={styles.cardTile}
                    style={{
                      width: TILE_W,
                      border: hasBlackBorder ? "6px solid #000" : "2px solid #e5e7eb",
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
                      <div className={styles.cardAgreement}>
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
          <div className={styles.sectionWrapper}>
            <section className={styles.sectionNeutral}>
              <div
                className={styles.sectionNeutralHeader}
                onClick={() => setNeutralOpen(true)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className={styles.sectionTitleNeutral}>どちらでも</div>
                  <div style={{ transform: neutralOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                    ^
                  </div>
                </div>
                <div className={styles.sectionCountNeutral}>{neuSorted.length}</div>
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
                  padding: "16px",
                  borderBottom: "1px solid #e5e7eb",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 18, color: "#111827" }}>
                  どちらでも（{neuSorted.length}）
                </div>
              </div>
              
              {/* カード表示エリア - スクロール可能 */}
              <div
                style={{
                  flex: 1,
                  padding: "16px",
                  overflow: "auto",
                }}
              >
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
                        <div style={{ fontWeight: 800, color: "#111827", fontSize: 13 }}>
                          {info?.title}
                        </div>
                        <div style={{ 
                          fontWeight: 900, 
                          color: "#fff", 
                          fontSize: 14,
                          background: "linear-gradient(135deg, #0ea5e9, #3b82f6)",
                          padding: "4px 10px",
                          borderRadius: 20,
                          boxShadow: "0 2px 6px rgba(59, 130, 246, 0.3)",
                          minWidth: 50,
                          textAlign: "center"
                        }}>
                          {ag.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
              
              {/* フッター - 固定配置の閉じるボタン */}
              <div
                style={{
                  padding: "12px 16px",
                  borderTop: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setNeutralOpen(false)}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#f3f4f6",
                    borderRadius: 8,
                    padding: "8px 24px",
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
              }))
            });
            
            // resultページと同じロジック: selectionsから直接取得
            // activeUserInfo は ID（p.idで設定される）であることを前提
            const user = selections.find((s) => 
              s.userId === activeUserInfo || 
              s.user === activeUserInfo
            );
            
            // displayParticipantsからも名前を取得
            const participant = displayParticipants.find(p => p.id === activeUserInfo);
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
                  <div style={{ display: "grid", gap: 8 }}>
                    {catOrder.map(({ key, label }) => {
                      const expanded = !!userInfoExpanded[key as string];
                      const toggle = () =>
                        setUserInfoExpanded((prev) => ({
                          ...prev,
                          [key as string]: !expanded,
                        }));
                      const list = getList(key);
                      const colors = categoryColors[key as string] || categoryColors.neutral;
                      
                      console.log(`[Play3] Category ${key}:`, {
                        expanded,
                        listLength: list.length,
                        list: list,
                        user: user ? { userId: user.userId, userName: user.userName } : null
                      });
                      
                      return (
                        <div
                          key={key}
                          style={{ 
                            border: `2px solid ${colors.border}`, 
                            borderRadius: 10,
                            background: colors.bg,
                          }}
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
                            <div style={{ fontWeight: 700, color: colors.text }}>{label}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontWeight: 800, color: colors.text }}>{list.length}</span>
                              <span
                                style={{
                                  transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                                  color: colors.text,
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
                                background: "#fff",
                              }}
                            >
                              {list.length ? (
                                list.map((c, idx) => {
                                  const info = getCard(c.id);
                                  const reason = (c as any).reason || "";
                                  
                                  console.log('[Play3] Card in user modal:', {
                                    cardId: c.id,
                                    foundInfo: info,
                                    title: info?.title,
                                    reason,
                                    allCardsLength: ALL_CARDS.length
                                  });
                                  
                                  return (
                                    <div
                                      key={idx}
                                      style={{
                                        border: "1px solid #d1d5db",
                                        borderRadius: 8,
                                        padding: 8,
                                        background: "#f9fafb",
                                      }}
                                    >
                                      <div
                                        style={{ fontWeight: 700, color: "#0f172a", fontSize: 13 }}
                                      >
                                        {info?.title || c.id}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: 11,
                                          color: reason ? "#475569" : "#94a3b8",
                                          marginTop: 4,
                                        }}
                                      >
                                        理由: {reason || "（なし）"}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div style={{ fontSize: 13, color: "#ef4444", fontWeight: 700, padding: "8px 0" }}>
                                  カードはありません
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                  if (activeVote?.phase === "voting" || activeVote?.phase === "finalizing") return;
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
                          background: votedNo ? "#1e40af" : "#60a5fa", // 柔らかい青
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedNo
                            ? "0 0 0 3px rgba(96,165,250,0.35) inset"
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
                          background: votedGo ? "#db2777" : "#f9a8d4", // ピンク
                          color: "#fff",
                          fontWeight: 900,
                          boxShadow: votedGo
                            ? "0 0 0 3px rgba(249,168,212,0.35) inset"
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
                          background: votedPending ? "#ca8a04" : "#fef08a", // 薄い黄色
                          color: votedPending ? "#fff" : "#713f12",
                          fontWeight: 900,
                          boxShadow: votedPending
                            ? "0 0 0 3px rgba(254,240,138,0.35) inset"
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
                            {(activeVote?.phase === "voting" || activeVote?.phase === "finalizing") && (
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
                                <div style={{ position: "relative" }}>
                                <button
                                  aria-pressed={votedNo}
                                  disabled={hasVoted && !votedNo}
                                  onClick={() => {
                                    console.log('No button clicked:', { 
                                      hasVoted, 
                                      activeVote: activeVote?.phase, 
                                      cardId: activeVote?.cardId, 
                                      modalCardId: cardModal.id 
                                    });
                                    if (!hasVoted) {
                                      // 指示書④: 既に投票中なら castVote、そうでなければ startVote
                                      if (
                                        activeVote?.phase === "voting" &&
                                        activeVote?.sessionId &&
                                        activeVote?.cardId === cardModal.id
                                      ) {
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
                            </div>

                            <div style={{ position: "relative" }}>
                              <button
                                aria-pressed={votedPending}
                                disabled={hasVoted && !votedPending}
                                onClick={() => {
                                  console.log('Pending button clicked:', { 
                                    hasVoted, 
                                    activeVote: activeVote?.phase, 
                                    cardId: activeVote?.cardId, 
                                    modalCardId: cardModal.id 
                                  });
                                  if (!hasVoted) {
                                    // 指示書④: 既に投票中なら castVote、そうでなければ startVote
                                    if (
                                      activeVote?.phase === "voting" &&
                                      activeVote?.sessionId &&
                                      activeVote?.cardId === cardModal.id
                                    ) {
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
                            </div>

                            <div style={{ position: "relative" }}>
                              <button
                                aria-pressed={votedGo}
                                disabled={hasVoted && !votedGo}
                                onClick={() => {
                                  console.log('Go button clicked:', { 
                                    hasVoted, 
                                    activeVote: activeVote?.phase, 
                                    cardId: activeVote?.cardId, 
                                    modalCardId: cardModal.id 
                                  });
                                  if (!hasVoted) {
                                    // 指示書④: 既に投票中なら castVote、そうでなければ startVote
                                    if (
                                      activeVote?.phase === "voting" &&
                                      activeVote?.sessionId &&
                                      activeVote?.cardId === cardModal.id
                                    ) {
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
                            </div>
                            </>
                            );
                            })()}
                            
                            {/* 投票キャンセルボタン（投票開始者のみ表示） */}
                            {activeVote?.phase === "voting" && activeVote.startedBy === myUserId && (
                              <div style={{ marginTop: 16, textAlign: "center" }}>
                                <button
                                  onClick={async () => {
                                    if (!roomId || typeof roomId !== "string" || !activeVote?.sessionId) return;
                                    // 投票を強制終了（phase: idle に戻す）
                                    await setDoc(
                                      doc(db, "rooms", roomId, "play3State", "state"),
                                      {
                                        phase: "idle" as VotePhase,
                                        cardId: null,
                                        sessionId: null,
                                        round: null,
                                        expectedUserIds: [],
                                        updatedAt: serverTimestamp(),
                                        // 後方互換
                                        modalOpen: false,
                                        initiatedById: null,
                                        initiatedByName: null,
                                      },
                                      { merge: true }
                                    );
                                    // セッションドキュメントも削除またはcancelled状態に
                                    await setDoc(
                                      doc(db, "rooms", roomId, PLAY3_VOTE_SESSIONS, activeVote.sessionId),
                                      {
                                        phase: "idle" as VotePhase,
                                        cancelled: true,
                                        cancelledAt: Date.now(),
                                        updatedAt: serverTimestamp(),
                                      },
                                      { merge: true }
                                    );
                                    setUiLocked(false);
                                    setUiLockReason(null);
                                    setMyVoteChoice(null);
                                    setVoteMap({});
                                    closeCard();
                                  }}
                                  style={{
                                    padding: "8px 20px",
                                    background: "#ef4444",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: 8,
                                    fontSize: 13,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                    boxShadow: "0 2px 8px rgba(239, 68, 68, 0.3)",
                                  }}
                                >
                                  投票をキャンセル
                                </button>
                              </div>
                            )}
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
            if (!roomId || typeof roomId !== "string" || !myUserId) return;
            
            console.log('終了ボタン押下:', { 
              roomId, 
              myUserId, 
              normalizedUserName,
              vsSortedLength: vsSorted.length,
              uiLocked,
              vsIds 
            });
            
            // play3Result コレクションに書き込み（ドキュメントIDはparticipantのID）
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
          title={
            vsSorted.length > 0 
              ? `VSカードが${vsSorted.length}枚残っています。先に決定してください。` 
              : uiLocked 
              ? "既に終了ボタンを押しました。他の参加者を待っています。" 
              : "クリックして結果ページに進む"
          }
        >
          終了して結果を見る
          {vsSorted.length > 0 && ` (VS: ${vsSorted.length}枚)`}
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
          
          console.log('終了待ちカウント:', {
            displayParticipants: displayParticipants.map(p => ({ id: p.id, name: p.name })),
            play3Ready,
            actualParticipantCount,
            readyCount,
            myUserId
          });
          
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
                終了しました。他の参加者の終了を待っています…（
                {readyCount}/{actualParticipantCount}）
              </div>
            </div>
          );
        })()}

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
                lineHeight: 1.4,
              }}
            >
              「{voteResultModal.cardName}」が<br />
              「{voteResultModal.area}」に決定しました！
            </div>
            <div
              style={{
                fontSize: 16,
                color: "#6b7280",
                marginBottom: 32,
                fontWeight: 600,
              }}
            >
              カードが移動しました
            </div>
            <button
              onClick={async () => {
                setVoteResultModal(null);
                // Firestoreから投票結果を削除
                if (roomId && typeof roomId === "string") {
                  await setDoc(
                    doc(db, "rooms", roomId, "play3State", "state"),
                    {
                      voteResult: null,
                    },
                    { merge: true }
                  );
                }
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

      {/* 参加者情報モーダル（result/page同様） */}
      {activeUserInfo && (() => {
        const user = displayParticipants.find(p => p.id === activeUserInfo);
        if (!user) return null;
        
        // ユーザーのcategories情報を取得
        const userSelection = selections.find(s => s.userId === activeUserInfo);
        
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
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 8 }}>
                {user.name}
              </div>
              <div style={{ color: "#374151", marginBottom: 10 }}>
                プラン名：<strong style={{ color: "#2563eb" }}>
                  {userSelection?.planName || "—"}
                </strong>
              </div>
              
              {/* カテゴリ別表示 */}
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  { key: "veryWant", label: "特に行きたい", color: "#fecaca", border: "#fca5a5" },
                  { key: "want", label: "行きたい", color: "#fce7f3", border: "#fbcfe8" },
                  { key: "neutral", label: "どちらでもいい", color: "#e5e7eb", border: "#d1d5db" },
                  { key: "dont", label: "行きたくない", color: "#bae6fd", border: "#93c5fd" },
                  { key: "veryDont", label: "特に行きたくない", color: "#93c5fd", border: "#60a5fa" },
                ].map(({ key, label, color, border }) => {
                  // userSelectionのcategoriesから該当カテゴリを取得
                  const list = userSelection?.categories?.[key as keyof typeof userSelection.categories] || [];
                  const count = Array.isArray(list) ? list.length : 0;
                  
                  return (
                    <div
                      key={key}
                      style={{
                        border: `1px solid ${border}`,
                        borderRadius: 10,
                        background: color,
                        padding: "8px 10px",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {label}: <strong>{count}</strong>枚
                      </div>
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
                    cursor: "pointer",
                  }}
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <MapButton />
    </div>
  );
}
