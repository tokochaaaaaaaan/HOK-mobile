"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { activeCards, CardData } from "@/data/cards";
import { useUser } from "@/context/UserContext";
import MapButton from "@/components/MapButton";
import { getCardTitleText, getFuriganaText } from "@/components/FuriganaText";
import { findIconByLabel, reasonIcons } from "@/utils/reasonIcons";
import { addAuthKey } from "../../../../../lib/firebase-auth";
import { db } from "../../../../../lib/firebase";
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc } from "firebase/firestore";

type AreaKey = "行きたい" | "どちらでもいい" | "行きたくない";

type MergeZoneKey = "want" | "neutral" | "dont" | "vs";

type SubmittedSelection = {
  userName: string;
  want: string[];
  neutral: string[];
  dont: string[];
};

type Mode = "view" | "note" | "move";

const areaMeta: Record<AreaKey, { title: string; border: string; bg: string; noteBg: string; noteColor: string }> = {
  行きたい: { title: "行きたい", border: "#16a34a", bg: "#f0fdf4", noteBg: "#dcfce7", noteColor: "#166534" },
  "どちらでもいい": { title: "どちらでもいい", border: "#f59e0b", bg: "#fffbeb", noteBg: "#fef3c7", noteColor: "#92400e" },
  行きたくない: { title: "行きたくない", border: "#ef4444", bg: "#fef2f2", noteBg: "#fee2e2", noteColor: "#991b1b" },
};

const AREA_KEYS: AreaKey[] = ["行きたい", "どちらでもいい", "行きたくない"];

const MERGE_ZONE_ORDER: MergeZoneKey[] = ["want", "neutral", "dont", "vs"];

const mergeAreaMeta: Record<
  MergeZoneKey,
  { title: string; border: string; bg: string; glow: string; left: number; top: number }
> = {
  want: { title: "行きたい", border: "#16a34a", bg: "#f0fdf4", glow: "rgba(22,163,74,0.18)", left: 24, top: 24 },
  neutral: { title: "どちらでもいい", border: "#f59e0b", bg: "#fffbeb", glow: "rgba(245,158,11,0.18)", left: 76, top: 24 },
  dont: { title: "行きたくない", border: "#ef4444", bg: "#fef2f2", glow: "rgba(239,68,68,0.18)", left: 24, top: 76 },
  vs: { title: "VS", border: "#64748b", bg: "#f1f5f9", glow: "rgba(100,116,139,0.18)", left: 76, top: 76 },
};

const mergeStartSlots = [
  { x: 14, y: 16, rotate: -16 },
  { x: 32, y: 12, rotate: -10 },
  { x: 68, y: 12, rotate: 10 },
  { x: 86, y: 16, rotate: 16 },
  { x: 10, y: 34, rotate: -18 },
  { x: 90, y: 34, rotate: 18 },
  { x: 12, y: 52, rotate: -12 },
  { x: 88, y: 52, rotate: 12 },
  { x: 10, y: 70, rotate: -16 },
  { x: 90, y: 70, rotate: 16 },
  { x: 14, y: 88, rotate: -12 },
  { x: 32, y: 92, rotate: -8 },
  { x: 68, y: 92, rotate: 8 },
  { x: 86, y: 88, rotate: 12 },
  { x: 50, y: 8, rotate: 0 },
  { x: 50, y: 96, rotate: 0 },
];

const mergeMixSlots = [
  { x: -88, y: -46, rotate: -18 },
  { x: -32, y: -56, rotate: -8 },
  { x: 28, y: -54, rotate: 10 },
  { x: 84, y: -40, rotate: 18 },
  { x: -102, y: 4, rotate: -16 },
  { x: -48, y: 0, rotate: -6 },
  { x: 6, y: -2, rotate: 5 },
  { x: 62, y: 2, rotate: 14 },
  { x: 104, y: 8, rotate: 17 },
  { x: -86, y: 52, rotate: -14 },
  { x: -28, y: 58, rotate: -4 },
  { x: 30, y: 56, rotate: 8 },
  { x: 88, y: 46, rotate: 15 },
  { x: -56, y: 104, rotate: -12 },
  { x: 0, y: 110, rotate: 0 },
  { x: 58, y: 104, rotate: 12 },
];

const mergeZoneSlotOffsets = [
  { x: -24, y: -18 },
  { x: 24, y: -18 },
  { x: -24, y: 18 },
  { x: 24, y: 18 },
];

export default function Mobile2Page() {
  const params = useParams();
  const router = useRouter();
  const roomId = Array.isArray((params as any)?.roomId) ? (params as any).roomId[0] : ((params as any)?.roomId as string);
  const { userName, cardPositions, setCardPositions } = useUser();

  const [mode, setMode] = useState<Mode>("view");

  const cardsByFrontSrc = useMemo(() => {
    const map = new Map<string, CardData>();
    for (const c of activeCards) map.set(c.frontSrc, c);
    return map;
  }, []);

  const availableReasonIcons = useMemo(
    () =>
      reasonIcons.filter(
        (icon) => !["gourmet", "shopping", "scenery", "design"].includes(icon.key)
      ),
    []
  );

  const [selectedFrontSrc, setSelectedFrontSrc] = useState<string | null>(null);
  const [selectedIsBack, setSelectedIsBack] = useState(false);

  const [notes, setNotes] = useState<Record<string, { text: string }>>({});
  const [editingNote, setEditingNote] = useState<null | { frontSrc: string; area: AreaKey }>(null);
  const [selectedReasonIndex, setSelectedReasonIndex] = useState<number | null>(null);
  const [noteDeleteConfirm, setNoteDeleteConfirm] = useState<null | { frontSrc: string; area: AreaKey }>(null);

  const [movePicker, setMovePicker] = useState<null | { frontSrc: string; fromArea: AreaKey }>(null);
  const [moveResultModal, setMoveResultModal] = useState<null | { frontSrc: string; toArea: AreaKey }>(null);

  const [showDiscussionConfirm, setShowDiscussionConfirm] = useState(false);
  const [discussionSubmitting, setDiscussionSubmitting] = useState(false);
  const [discussionError, setDiscussionError] = useState<string | null>(null);
  const [expectedUserNames, setExpectedUserNames] = useState<string[]>([]);
  const [discussionReadyMap, setDiscussionReadyMap] = useState<Record<string, boolean>>({});
  const [selfDiscussionReady, setSelfDiscussionReady] = useState(false);
  const [showMergeTransition, setShowMergeTransition] = useState(false);
  const [mergeStep, setMergeStep] = useState<"gather" | "mix" | "sort">("gather");
  const [hasStartedMergeTransition, setHasStartedMergeTransition] = useState(false);
  const [hasLoadedSubmittedSelections, setHasLoadedSubmittedSelections] = useState(false);
  const [submittedSelections, setSubmittedSelections] = useState<SubmittedSelection[]>([]);
  const [showDestinationReveal, setShowDestinationReveal] = useState(false);
  const [showMissionAlert, setShowMissionAlert] = useState(false);
  const [showMissionModal, setShowMissionModal] = useState(false);
  const mergeAudioContextRef = useRef<AudioContext | null>(null);
  const lastPlayedMergeStepRef = useRef<"gather" | "mix" | "sort" | null>(null);
  const missionAlertTimerRef = useRef<number | null>(null);

  usePreventBack();

  // 参加者一覧（rooms/{roomId}.participants）購読
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const unsub = onSnapshot(doc(db, "rooms", roomId), (snap) => {
      if (!snap.exists()) {
        setExpectedUserNames([]);
        return;
      }
      const data: any = snap.data();
      const parts = data?.participants || {};
      const names = Object.values(parts)
        .map((v: any) => (typeof v === "string" ? v : v?.name))
        .map((v: any) => (typeof v === "string" ? v.trim() : ""))
        .filter((v: string) => v.length > 0);
      setExpectedUserNames(Array.from(new Set(names)));
    });
    return () => unsub();
  }, [roomId]);

  // 議論準備状況（rooms/{roomId}/mobileDiscussionReady）購読
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const q = query(collection(db, "rooms", roomId, "mobileDiscussionReady"));
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, boolean> = {};
      snap.docs.forEach((d) => {
        const data: any = d.data();
        if (data?.ready) map[String(data.userId || d.id)] = true;
      });
      setDiscussionReadyMap(map);
    });
    return () => unsub();
  }, [roomId]);

  // mobile2提出結果（finalSelections）購読: 遷移演出の分岐判定に使う
  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
    const qSel = query(collection(db, "rooms", roomId, "finalSelections"));
    const unsub = onSnapshot(qSel, (snap) => {
      const list: SubmittedSelection[] = [];

      const toItems = (arr: any): Array<{ id: string }> => {
        if (!Array.isArray(arr)) return [];
        return arr
          .map((v) => {
            if (!v) return null;
            if (typeof v === "string") return { id: v };
            if (typeof v === "object" && typeof (v as any).id === "string") return { id: (v as any).id };
            return null;
          })
          .filter(Boolean) as Array<{ id: string }>;
      };

      snap.docs.forEach((d) => {
        const data: any = d.data();
        const name = String(data?.userName || data?.userId || data?.user || d.id || "").trim();
        const raw = data?.categories || {};
        if (!name) return;

        const want = [...toItems(raw.want), ...toItems(raw.veryWant)].map((item) => String(item.id).trim()).filter(Boolean);
        const neutral = toItems(raw.neutral).map((item) => String(item.id).trim()).filter(Boolean);
        const dont = [...toItems(raw.dont), ...toItems(raw.veryDont)].map((item) => String(item.id).trim()).filter(Boolean);

        list.push({ userName: name, want, neutral, dont });
      });

      if (expectedUserNames.length > 0) {
        const by = new Map(list.map((v) => [v.userName, v] as const));
        const ordered: SubmittedSelection[] = [];
        expectedUserNames.forEach((name) => {
          const hit = by.get(name);
          if (hit) ordered.push(hit);
        });
        list.forEach((item) => {
          if (!ordered.some((v) => v.userName === item.userName)) ordered.push(item);
        });
        setSubmittedSelections(ordered);
      } else {
        setSubmittedSelections(list);
      }

      setHasLoadedSubmittedSelections(true);
    });
    return () => unsub();
  }, [roomId, expectedUserNames]);

  const getAreaCards = (area: AreaKey): string[] => {
    const arr = cardPositions?.[area] || [];
    // activeCards以外（過去データ）の混入を避ける
    return arr.filter((src) => cardsByFrontSrc.has(src));
  };

  const openCard = (frontSrc: string) => {
    if (mode !== "view") return;
    setSelectedFrontSrc(frontSrc);
    setSelectedIsBack(false);
  };

  const closeCard = () => {
    setSelectedFrontSrc(null);
    setSelectedIsBack(false);
  };

  const ensureNoteAndEdit = (frontSrc: string, area: AreaKey) => {
    const existing = notes[frontSrc]?.text ?? "";
    setEditingNote({ frontSrc, area });
    const existingIcon = findIconByLabel(existing);
    const iconIndex = existingIcon ? availableReasonIcons.findIndex((icon) => icon.key === existingIcon.key) : -1;
    setSelectedReasonIndex(iconIndex >= 0 ? iconIndex : null);
  };

  const removeNote = (frontSrc: string) => {
    setNotes((prev) => {
      if (!prev[frontSrc]) return prev;
      const next = { ...prev };
      delete next[frontSrc];
      return next;
    });
    if (editingNote?.frontSrc === frontSrc) {
      setEditingNote(null);
      setSelectedReasonIndex(null);
    }
  };

  const requestRemoveNote = (frontSrc: string, area: AreaKey) => {
    setNoteDeleteConfirm({ frontSrc, area });
  };

  const saveNote = () => {
    if (!editingNote) return;
    const key = editingNote.frontSrc;
    const selectedReason = selectedReasonIndex != null ? availableReasonIcons[selectedReasonIndex]?.fullText ?? "" : "";
    if (!selectedReason) {
      setNotes((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setNotes((prev) => ({ ...prev, [key]: { text: selectedReason } }));
    }
    setEditingNote(null);
    setSelectedReasonIndex(null);
  };

  const cancelNote = () => {
    setEditingNote(null);
    setSelectedReasonIndex(null);
  };

  const moveCardTo = (frontSrc: string, fromArea: AreaKey, toArea: AreaKey) => {
    if (fromArea === toArea) return;
    setCardPositions((prev) => {
      const next: Record<string, string[]> = {
        ...prev,
        行きたい: [...(prev["行きたい"] || [])],
        "どちらでもいい": [...(prev["どちらでもいい"] || [])],
        行きたくない: [...(prev["行きたくない"] || [])],
      };

      const removeOne = (arr: string[], value: string) => {
        const idx = arr.lastIndexOf(value);
        if (idx >= 0) arr.splice(idx, 1);
      };
      removeOne(next[fromArea], frontSrc);
      next[toArea].push(frontSrc);
      return next;
    });

    setMoveResultModal({ frontSrc, toArea });
  };

  const onCardTap = (frontSrc: string, area: AreaKey) => {
    if (mode === "note") {
      const t = notes[frontSrc]?.text?.trim() ?? "";
      if (t.length > 0) {
        requestRemoveNote(frontSrc, area);
        return;
      }
      ensureNoteAndEdit(frontSrc, area);
      return;
    }
    if (mode === "move") {
      setMovePicker({ frontSrc, fromArea: area });
      return;
    }
    openCard(frontSrc);
  };

  const expectedCount = expectedUserNames.length > 0 ? expectedUserNames.length : Object.keys(discussionReadyMap).length;
  const readyCount =
    expectedUserNames.length > 0
      ? expectedUserNames.reduce((acc, name) => acc + (discussionReadyMap[name] ? 1 : 0), 0)
      : Object.values(discussionReadyMap).filter(Boolean).length;

  const transitionParticipants = useMemo(() => {
    const fallbackNames = Object.keys(discussionReadyMap).filter(Boolean);
    const source = expectedUserNames.length > 0 ? expectedUserNames : fallbackNames;
    const cleaned = source.map((name) => name.trim()).filter(Boolean);
    const unique = Array.from(new Set(cleaned));
    return unique.length > 0 ? unique : [userName?.trim() || "みんな"];
  }, [discussionReadyMap, expectedUserNames, userName]);

  const mergeParticipantCount = Math.min(Math.max(transitionParticipants.length, 1), 4);

  const mergeCards = useMemo(
    () =>
      Array.from({ length: mergeParticipantCount }).flatMap((_, participantIndex) =>
        MERGE_ZONE_ORDER.map((zone, zoneIndex) => {
          const index = participantIndex * MERGE_ZONE_ORDER.length + zoneIndex;
          const startSlot = mergeStartSlots[index] || mergeStartSlots[mergeStartSlots.length - 1];
          const mixSlot = mergeMixSlots[index] || mergeMixSlots[mergeMixSlots.length - 1];
          const slotOffset = mergeZoneSlotOffsets[participantIndex] || mergeZoneSlotOffsets[mergeZoneSlotOffsets.length - 1];
          const zoneLayout = mergeAreaMeta[zone];

          return {
            id: `merge-${participantIndex + 1}-${zone}`,
            label: String(participantIndex + 1),
            zone,
            startX: startSlot.x,
            startY: startSlot.y,
            startRotate: startSlot.rotate,
            mixX: mixSlot.x,
            mixY: mixSlot.y,
            mixRotate: mixSlot.rotate,
            sortLeft: zoneLayout.left,
            sortTop: zoneLayout.top,
            sortOffsetX: slotOffset.x,
            sortOffsetY: slotOffset.y,
          };
        })
      ),
    [mergeParticipantCount]
  );

  const mergeDecisionSummary = useMemo(() => {
    const activeCardItems = activeCards.map((card) => ({
      card,
      cardId: `card${card.id}`,
    }));

    const wantCount: Record<string, number> = {};
    const dontCount: Record<string, number> = {};

    const inc = (bucket: Record<string, number>, cardId: string) => {
      bucket[cardId] = (bucket[cardId] || 0) + 1;
    };

    submittedSelections.forEach((selection) => {
      selection.want.forEach((cid) => inc(wantCount, cid));
      selection.dont.forEach((cid) => inc(dontCount, cid));
    });

    const goCards = activeCardItems.filter(({ cardId }) => (wantCount[cardId] || 0) >= 1 && (dontCount[cardId] || 0) === 0);
    const vsCards = activeCardItems.filter(({ cardId }) => (wantCount[cardId] || 0) >= 1 && (dontCount[cardId] || 0) >= 1);

    return {
      goCards,
      vsCards,
      hasVs: vsCards.length > 0,
    };
  }, [submittedSelections]);

  useEffect(() => {
    if (!selfDiscussionReady) return;
    if (!roomId || typeof roomId !== "string") return;
    if (expectedCount >= 1 && readyCount === expectedCount && readyCount > 0 && !hasStartedMergeTransition) {
      setHasStartedMergeTransition(true);
      setShowDiscussionConfirm(false);
      setShowMergeTransition(true);
      setMergeStep("gather");
    }
  }, [selfDiscussionReady, expectedCount, readyCount, roomId, hasStartedMergeTransition]);

  useEffect(() => {
    if (!showMergeTransition) return;
    if (!roomId || typeof roomId !== "string") return;

    const mixTimer = window.setTimeout(() => setMergeStep("mix"), 3200);
    const sortTimer = window.setTimeout(() => setMergeStep("sort"), 6600);
    const revealTimer = window.setTimeout(() => {
      setShowDestinationReveal(true);
    }, 10000);

    return () => {
      window.clearTimeout(mixTimer);
      window.clearTimeout(sortTimer);
      window.clearTimeout(revealTimer);
    };
  }, [showMergeTransition, roomId]);

  useEffect(() => {
    return () => {
      if (missionAlertTimerRef.current) {
        window.clearTimeout(missionAlertTimerRef.current);
        missionAlertTimerRef.current = null;
      }
      if (mergeAudioContextRef.current) {
        void mergeAudioContextRef.current.close().catch(() => undefined);
        mergeAudioContextRef.current = null;
      }
    };
  }, []);

  const ensureMergeAudioReady = async () => {
    if (typeof window === "undefined") return null;
    const AudioCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;

    if (!mergeAudioContextRef.current) {
      mergeAudioContextRef.current = new AudioCtor();
    }

    if (mergeAudioContextRef.current.state === "suspended") {
      await mergeAudioContextRef.current.resume().catch(() => undefined);
    }

    return mergeAudioContextRef.current;
  };

  const playMergeEffect = async (step: "gather" | "mix" | "sort") => {
    const ctx = await ensureMergeAudioReady();
    if (!ctx) return;

    const pulse = (frequency: number, startOffset: number, duration: number, type: OscillatorType, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = ctx.currentTime + startOffset;
      const endAt = startAt + duration;

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, startAt);
      if (step === "mix") {
        osc.frequency.exponentialRampToValueAtTime(frequency * 1.08, endAt);
      }

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + duration * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt);
    };

    if (step === "gather") {
      pulse(720, 0, 0.08, "triangle", 0.035);
      pulse(980, 0.08, 0.1, "triangle", 0.04);
      pulse(1280, 0.18, 0.12, "sine", 0.03);
      return;
    }

    if (step === "mix") {
      pulse(360, 0, 0.16, "square", 0.02);
      pulse(420, 0.08, 0.16, "square", 0.02);
      pulse(540, 0.16, 0.18, "triangle", 0.025);
      pulse(660, 0.24, 0.18, "triangle", 0.025);
      return;
    }

    pulse(640, 0, 0.08, "triangle", 0.03);
    pulse(760, 0.08, 0.08, "triangle", 0.03);
    pulse(900, 0.16, 0.08, "triangle", 0.03);
    pulse(1040, 0.24, 0.12, "sine", 0.028);
  };

  const playMissionAlertEffect = async () => {
    const ctx = await ensureMergeAudioReady();
    if (!ctx) return;

    const burst = (frequency: number, startOffset: number, duration: number, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const startAt = ctx.currentTime + startOffset;
      const endAt = startAt + duration;

      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(frequency, startAt);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.72, endAt);

      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1500, startAt);
      filter.frequency.exponentialRampToValueAtTime(700, endAt);

      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + duration * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(endAt);
    };

    burst(420, 0, 0.22, 0.03);
    burst(530, 0.12, 0.24, 0.028);
    burst(690, 0.3, 0.32, 0.026);
  };

  useEffect(() => {
    if (!showMergeTransition) return;
    if (lastPlayedMergeStepRef.current === mergeStep) return;
    lastPlayedMergeStepRef.current = mergeStep;
    void playMergeEffect(mergeStep);
  }, [mergeStep, showMergeTransition]);

  useEffect(() => {
    if (!showMissionAlert) return;
    void playMissionAlertEffect();

    missionAlertTimerRef.current = window.setTimeout(() => {
      setShowMissionAlert(false);
      setShowMissionModal(true);
      missionAlertTimerRef.current = null;
    }, 2500);

    return () => {
      if (missionAlertTimerRef.current) {
        window.clearTimeout(missionAlertTimerRef.current);
        missionAlertTimerRef.current = null;
      }
    };
  }, [showMissionAlert]);

  const submitAndReadyForDiscussion = async () => {
    if (!roomId || typeof roomId !== "string") throw new Error("roomIdが不正です");
    if (!userName || !userName.trim()) throw new Error("名前が未設定です");
    await ensureMergeAudioReady();

    const positionsFrontSrc = {
      行きたい: cardPositions?.["行きたい"] || [],
      "どちらでもいい": cardPositions?.["どちらでもいい"] || [],
      行きたくない: cardPositions?.["行きたくない"] || [],
    } as const;

    const toCardIds = (arr: string[]) =>
      arr
        .map((frontSrc) => cardsByFrontSrc.get(frontSrc)?.id)
        .filter((id): id is number => typeof id === "number");

    const positionsCardIds = {
      行きたい: toCardIds(positionsFrontSrc.行きたい),
      "どちらでもいい": toCardIds(positionsFrontSrc["どちらでもいい"]),
      行きたくない: toCardIds(positionsFrontSrc.行きたくない),
    };

    const notesByFrontSrc: Record<string, string> = {};
    Object.entries(notes).forEach(([frontSrc, v]) => {
      notesByFrontSrc[frontSrc] = v.text;
    });

    const notesByCardId: Record<string, string> = {};
    Object.entries(notes).forEach(([frontSrc, v]) => {
      const cid = cardsByFrontSrc.get(frontSrc)?.id;
      if (cid != null) notesByCardId[String(cid)] = v.text;
    });

    const submittedAt = new Date().toISOString();

    const toCardItems = (frontSrcArr: string[]) =>
      frontSrcArr
        .map((frontSrc) => {
          const card = cardsByFrontSrc.get(frontSrc);
          if (!card) return null;
          const reason = (notes[frontSrc]?.text ?? "").trim();
          return reason ? { id: `card${card.id}`, reason } : { id: `card${card.id}` };
        })
        .filter(Boolean) as Array<{ id: string; reason?: string }>;

    const finalSelectionsCategories = {
      veryWant: [] as Array<{ id: string; reason?: string }>,
      want: toCardItems(positionsFrontSrc.行きたい),
      neutral: toCardItems(positionsFrontSrc["どちらでもいい"]),
      dont: toCardItems(positionsFrontSrc.行きたくない),
      veryDont: [] as Array<{ id: string; reason?: string }>,
    };

    await setDoc(
      doc(db, "rooms", roomId, "mobileFinalSelections", userName),
      addAuthKey({
        userId: userName,
        userName,
        positionsFrontSrc,
        positionsCardIds,
        notesByFrontSrc,
        notesByCardId,
        submittedAt,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );

    // 既存のresult画面互換: finalSelections にも保存
    await setDoc(
      doc(db, "rooms", roomId, "finalSelections", userName),
      addAuthKey({
        user: userName,
        userId: userName,
        userName,
        planName: "",
        planname: "",
        categories: finalSelectionsCategories,
        isReady: true,
        submittedAt,
        updatedAt: serverTimestamp(),
        timestamp: serverTimestamp(),
      }),
      { merge: true }
    );

    await setDoc(
      doc(db, "rooms", roomId, "mobileDiscussionReady", userName),
      addAuthKey({
        userId: userName,
        userName,
        ready: true,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    );
  };

  const selectedCard = selectedFrontSrc ? cardsByFrontSrc.get(selectedFrontSrc) ?? null : null;
  useBodyScrollLock(
    !!selectedCard ||
      !!editingNote ||
      !!movePicker ||
      !!noteDeleteConfirm ||
      !!moveResultModal ||
      showDiscussionConfirm ||
      showMergeTransition ||
      showDestinationReveal ||
        showMissionAlert ||
      showMissionModal
  );

  const proceedAfterDestinationReveal = () => {
    setShowDestinationReveal(false);
    if (mergeDecisionSummary.hasVs) {
      setShowMissionAlert(true);
      return;
    }
    router.push(`/room/${roomId}/mobile3?autofinish=1`);
  };

  const openMissionDiscussion = () => {
    setShowMissionModal(false);
    router.push(`/room/${roomId}/mobile3`);
  };

  const mergeHeadline =
    mergeStep === "gather"
      ? "みんなのカードを集めてるよ！"
      : mergeStep === "mix"
        ? "同じ意見のカードを合体してるよ！"
        : "4つのエリアにならべてるよ！";

  const mergeSubline =
    mergeStep === "gather"
      ? "みんなのカードが集まり、、、！"
      : mergeStep === "mix"
        ? "カードが意見ごとに分かれて、、、！"
        : "それぞれの場所に移動していくよ";

  const mergeAccentColor =
    mergeStep === "gather" ? "#2563eb" : mergeStep === "mix" ? "#f59e0b" : "#16a34a";

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        backgroundColor: "#fff",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)",
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        boxSizing: "border-box",
        overscrollBehavior: "none",
      }}
    >
      <div style={{ width: "100%", maxWidth: "560px", fontFamily: "Arial, sans-serif" }}>
        <style>
          {`
            @keyframes missionAlertBackdropIn {
              0% { opacity: 0; }
              100% { opacity: 1; }
            }

            @keyframes missionAlertCoreIn {
              0% { transform: scale(0.72) rotate(-8deg); opacity: 0; }
              55% { transform: scale(1.08) rotate(2deg); opacity: 1; }
              100% { transform: scale(1) rotate(0deg); opacity: 1; }
            }

            @keyframes missionAlertRing {
              0% { transform: translate(-50%, -50%) scale(0.35); opacity: 0.85; }
              100% { transform: translate(-50%, -50%) scale(1.45); opacity: 0; }
            }

            @keyframes missionAlertShake {
              0%, 100% { transform: translateX(0); }
              20% { transform: translateX(-8px); }
              40% { transform: translateX(8px); }
              60% { transform: translateX(-6px); }
              80% { transform: translateX(6px); }
            }

            @keyframes missionBadgePulse {
              0%, 100% { transform: scale(1); box-shadow: 0 18px 36px rgba(239,68,68,0.22); }
              50% { transform: scale(1.06); box-shadow: 0 24px 48px rgba(239,68,68,0.34); }
            }

            @keyframes missionModalPop {
              0% { transform: translateY(28px) scale(0.9); opacity: 0; }
              65% { transform: translateY(-6px) scale(1.02); opacity: 1; }
              100% { transform: translateY(0) scale(1); opacity: 1; }
            }

            @keyframes missionCardEnter {
              0% { transform: translateY(18px) scale(0.94); opacity: 0; }
              100% { transform: translateY(0) scale(1); opacity: 1; }
            }

            @keyframes missionButtonGlow {
              0%, 100% { box-shadow: 0 14px 28px rgba(220,38,38,0.24); }
              50% { box-shadow: 0 18px 36px rgba(220,38,38,0.38); }
            }
          `}
        </style>
        <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#0f172a", marginBottom: 12 }}>
          {getFuriganaText("カードに付箋をつけよう！")}
        </div>

        <div
          style={{
            fontWeight: 900,
            color: "#334155",
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          {getFuriganaText("カードに付箋をつけて振り分けた理由を表現しよう！")}
        </div>

        {AREA_KEYS.map((area) => {
          const list = getAreaCards(area);
          const meta = areaMeta[area];
          return (
            <div
              key={area}
              style={{
                border: `2px solid ${meta.border}`,
                backgroundColor: meta.bg,
                borderRadius: "16px",
                padding: "12px",
                marginBottom: "12px",
              }}
            >
              <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>
                {getFuriganaText(meta.title)}（{list.length}）
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: "8px",
                }}
              >
                {list.map((frontSrc) => {
                  const card = cardsByFrontSrc.get(frontSrc);
                  if (!card) return null;
                  const noteText = (notes[frontSrc]?.text ?? "").trim();
                  const hasNote = noteText.length > 0;
                  const noteIcon = findIconByLabel(noteText);

                  return (
                    <div
                      key={frontSrc}
                      role="button"
                      tabIndex={0}
                      onClick={() => onCardTap(frontSrc, area)}
                      style={{
                        position: "relative",
                        borderRadius: "12px",
                        overflow: "hidden",
                        border: "1px solid rgba(15,23,42,0.12)",
                        backgroundColor: "#fff",
                        aspectRatio: "3 / 4",
                        touchAction: "manipulation",
                        cursor: "pointer",
                      }}
                      aria-label={card.title}
                      title={card.title}
                    >
                      <img
                        src={card.frontSrc}
                        alt={card.title}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                        draggable={false}
                      />

                      {/* 付箋 */}
                      {hasNote && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mode === "move") {
                              setMovePicker({ frontSrc, fromArea: area });
                              return;
                            }
                            if (mode === "note") {
                              requestRemoveNote(frontSrc, area);
                              return;
                            }
                            ensureNoteAndEdit(frontSrc, area);
                          }}
                          style={{
                            position: "absolute",
                            bottom: 8,
                            left: 8,
                            width: "calc(100% - 16px)",
                            maxWidth: "calc(100% - 16px)",
                            padding: "8px 10px",
                            borderRadius: "10px",
                            border: `1px solid rgba(15,23,42,0.16)`,
                            backgroundColor: meta.noteBg,
                            color: meta.noteColor,
                            fontWeight: 900,
                            fontSize: "0.75rem",
                            lineHeight: 1.15,
                            textAlign: "left",
                            boxShadow: "0 6px 16px rgba(0,0,0,0.18)",
                            transform: "rotate(-1.8deg)",
                            transformOrigin: "left bottom",
                            overflow: "hidden",
                            cursor: "pointer",
                          }}
                          aria-label={mode === "note" ? "付箋を外す" : "付箋を編集"}
                          title={noteText || "付箋"}
                        >
                          {/* 折り返し風 */}
                          <div
                            style={{
                              position: "absolute",
                              top: 0,
                              right: 0,
                              width: 0,
                              height: 0,
                              borderStyle: "solid",
                              borderWidth: "0 0 16px 16px",
                              borderColor: "transparent transparent rgba(15,23,42,0.18) transparent",
                              opacity: 0.55,
                            }}
                          />
                          <div style={{ fontSize: "0.62rem", opacity: 0.85, letterSpacing: "0.02em" }}>{getFuriganaText("付箋")}</div>
                          <div
                            style={{
                              marginTop: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {noteIcon ? (
                              <>
                                {noteIcon.emoji} {getFuriganaText(noteIcon.fullText)}
                              </>
                            ) : (
                              getFuriganaText(noteText)
                            )}
                          </div>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 下部アクションバー */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          paddingTop: "10px",
          paddingLeft: "16px",
          paddingRight: "16px",
          backgroundColor: "rgba(255,255,255,0.92)",
          borderTop: "1px solid rgba(15,23,42,0.12)",
          backdropFilter: "blur(8px)",
          zIndex: 1200,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "560px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "10px",
          }}
        >
          <button
            onClick={() => setMode((m) => (m === "note" ? "view" : "note"))}
            style={{
              minHeight: "48px",
              borderRadius: "14px",
              border: "1px solid rgba(15,23,42,0.14)",
              backgroundColor: mode === "note" ? "#0f172a" : "#fff",
              color: mode === "note" ? "#fff" : "#0f172a",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            🏷️ {getFuriganaText("付箋をつける/外す")}
          </button>

          <button
            onClick={() => setMode((m) => (m === "move" ? "view" : "move"))}
            style={{
              minHeight: "48px",
              borderRadius: "14px",
              border: "1px solid rgba(15,23,42,0.14)",
              backgroundColor: mode === "move" ? "#0f172a" : "#fff",
              color: mode === "move" ? "#fff" : "#0f172a",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            ↔︎ {getFuriganaText("カード移動")}
          </button>

          <div
            style={
              {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                "--map-btn-size": "48px",
                "--map-btn-radius": "14px",
              } as any
            }
          >
            <MapButton variant="inline" showLabel={false} />
          </div>
        </div>

        <div style={{ width: "100%", maxWidth: "560px", margin: "10px auto 0" }}>
          <button
            onClick={() => {
              setDiscussionError(null);
              setShowDiscussionConfirm(true);
            }}
            style={{
              width: "100%",
              minHeight: "50px",
              borderRadius: "14px",
              border: "none",
              backgroundColor: "#2563EB",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {getFuriganaText("次のページに進んで話し合いをする！")}
          </button>
        </div>
      </div>

      {/* 議論へ確認 */}
      {showDiscussionConfirm && (
        <div
          onClick={() => {
            if (discussionSubmitting) return;
            setShowDiscussionConfirm(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 1550,
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              backgroundColor: "#fff",
              borderRadius: "18px",
              padding: "14px",
              boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#0f172a" }}>{getFuriganaText("話し合いの前に、、、")}</div>
            <div style={{ fontWeight: 900, color: "#334155", lineHeight: 1.6 }}>
              {getFuriganaText("他の人を待つよ！付箋をつけられるのはここまで！つけ忘れはない？")}
            </div>

            {discussionError && (
              <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900, lineHeight: 1.5 }}>{discussionError}</div>
            )}

            {selfDiscussionReady && (
              <div style={{ marginTop: 10, fontWeight: 900, color: "#0f172a" }}>
                {getFuriganaText("他の参加者を待っています…")}（{readyCount} / {expectedCount || "?"}）
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: 12 }}>
              <button
                onClick={() => {
                  if (discussionSubmitting) return;
                  setShowDiscussionConfirm(false);
                }}
                disabled={discussionSubmitting}
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "1px solid rgba(15,23,42,0.14)",
                  backgroundColor: "#fff",
                  color: "#0f172a",
                  fontWeight: 900,
                  cursor: discussionSubmitting ? "not-allowed" : "pointer",
                  opacity: discussionSubmitting ? 0.7 : 1,
                }}
              >
                いいえ
              </button>
              <button
                onClick={async () => {
                  if (discussionSubmitting) return;
                  try {
                    setDiscussionSubmitting(true);
                    setDiscussionError(null);
                    await submitAndReadyForDiscussion();
                    setSelfDiscussionReady(true);
                  } catch (e: any) {
                    setDiscussionError(e?.message || "送信に失敗しました");
                  } finally {
                    setDiscussionSubmitting(false);
                  }
                }}
                disabled={discussionSubmitting || selfDiscussionReady}
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "none",
                  backgroundColor: "#0f172a",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: discussionSubmitting || selfDiscussionReady ? "not-allowed" : "pointer",
                  opacity: discussionSubmitting || selfDiscussionReady ? 0.7 : 1,
                }}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カード拡大（タップで表→裏） */}
      {selectedCard && (
        <div
          onClick={closeCard}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.78)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1400,
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIsBack((v) => !v);
            }}
            style={{
              width: "min(520px, 100%)",
              aspectRatio: "3 / 4",
              borderRadius: "18px",
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
              style={{
                position: "absolute",
                inset: 0,
                transformStyle: "preserve-3d",
                transition: "transform 260ms ease",
                transform: `rotateY(${selectedIsBack ? 180 : 0}deg)`,
              }}
            >
              <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}>
                <img
                  src={selectedCard.frontSrc}
                  alt={selectedCard.title}
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
                  src={selectedCard.backSrc}
                  alt={selectedCard.title}
                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  draggable={false}
                />
              </div>
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                closeCard();
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
              aria-label="閉じる"
            >
              {getFuriganaText("閉じる")}
            </button>
          </div>
        </div>
      )}

      {/* 付箋編集 */}
      {editingNote && (
        <div
          onClick={cancelNote}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 1500,
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              backgroundColor: "#fff",
              borderRadius: "18px",
              padding: "14px",
              boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
              border: `2px solid ${areaMeta[editingNote.area].border}`,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#0f172a" }}>{getFuriganaText("理由（付箋）")}</div>
            <div style={{ fontWeight: 900, marginBottom: 10, color: "#334155" }}>{getFuriganaText("理由を選択")}</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "10px",
                maxHeight: "48dvh",
                overflowY: "auto",
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
                paddingRight: "2px",
              }}
            >
              {availableReasonIcons.map((icon, index) => {
                const selected = selectedReasonIndex === index;
                return (
                  <button
                    key={icon.key}
                    type="button"
                    onClick={() => setSelectedReasonIndex(index)}
                    style={{
                      borderRadius: "14px",
                      border: selected ? `2px solid ${areaMeta[editingNote.area].border}` : "1px solid rgba(15,23,42,0.12)",
                      backgroundColor: selected ? areaMeta[editingNote.area].bg : "#fff",
                      padding: "12px 8px",
                      cursor: "pointer",
                      boxShadow: selected ? "0 10px 24px rgba(15,23,42,0.12)" : "none",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      minHeight: "92px",
                    }}
                    aria-pressed={selected}
                    title={icon.fullText}
                  >
                    <div style={{ fontSize: "1.8rem", lineHeight: 1 }}>{icon.emoji}</div>
                    <div style={{ fontWeight: 900, fontSize: "0.76rem", color: "#0f172a", textAlign: "center", lineHeight: 1.25 }}>
                      {getFuriganaText(icon.fullText)}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: 10 }}>
              <button
                onClick={cancelNote}
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "1px solid rgba(15,23,42,0.14)",
                  backgroundColor: "#fff",
                  color: "#0f172a",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                onClick={saveNote}
                disabled={selectedReasonIndex == null}
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "none",
                  backgroundColor: selectedReasonIndex == null ? "#93c5fd" : "#2563EB",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: selectedReasonIndex == null ? "not-allowed" : "pointer",
                }}
              >
                {getFuriganaText("保存")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 付箋削除確認 */}
      {noteDeleteConfirm && (
        <div
          onClick={() => setNoteDeleteConfirm(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1500,
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              backgroundColor: "#fff",
              borderRadius: "18px",
              padding: "14px",
              boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
              border: `2px solid ${areaMeta[noteDeleteConfirm.area].border}`,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#0f172a" }}>{getFuriganaText("付箋を消しますか？")}</div>
            <div style={{ fontWeight: 900, color: "#334155", lineHeight: 1.6 }}>
              {getFuriganaText("この付箋を消してもいいですか？")}
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: 12 }}>
              <button
                onClick={() => setNoteDeleteConfirm(null)}
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "none",
                  backgroundColor: "#dc2626",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {getFuriganaText("消さない")}
              </button>
              <button
                onClick={() => {
                  removeNote(noteDeleteConfirm.frontSrc);
                  setNoteDeleteConfirm(null);
                }}
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "1px solid rgba(15,23,42,0.14)",
                  backgroundColor: "#fff",
                  color: "#0f172a",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {getFuriganaText("消す")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* カード移動ピッカー */}
      {movePicker && (
        <div
          onClick={() => setMovePicker(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1500,
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              backgroundColor: "#fff",
              borderRadius: "18px",
              padding: "14px",
              boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10, color: "#0f172a" }}>{getFuriganaText("移動先を選択")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
              {AREA_KEYS.map((toArea) => {
                const meta = areaMeta[toArea];
                return (
                  <button
                    key={toArea}
                    onClick={() => {
                      moveCardTo(movePicker.frontSrc, movePicker.fromArea, toArea);
                      setMovePicker(null);
                    }}
                    style={{
                      minHeight: "48px",
                      borderRadius: "14px",
                      border: `2px solid ${meta.border}`,
                      backgroundColor: meta.bg,
                      color: "#0f172a",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    {getFuriganaText(meta.title)}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setMovePicker(null)}
              style={{
                width: "100%",
                minHeight: "46px",
                marginTop: 10,
                borderRadius: "14px",
                border: "1px solid rgba(15,23,42,0.14)",
                backgroundColor: "#fff",
                color: "#0f172a",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {getFuriganaText("閉じる")}
            </button>
          </div>
        </div>
      )}

      {/* カード移動完了 */}
      {moveResultModal && (
        <div
          onClick={() => setMoveResultModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1510,
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, 100%)",
              backgroundColor: "#fff",
              borderRadius: "18px",
              padding: "14px",
              boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
              border: `2px solid ${areaMeta[moveResultModal.toArea].border}`,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#0f172a" }}>{getFuriganaText("カード移動")}</div>
            <div style={{ fontWeight: 900, color: "#334155", lineHeight: 1.6 }}>
              {getCardTitleText(cardsByFrontSrc.get(moveResultModal.frontSrc)?.title ?? "カード")}
              <span> を </span>
              {getFuriganaText(moveResultModal.toArea)}
              <span> に </span>
              {getFuriganaText("移動しました")}
              <span>。</span>
            </div>
            <button
              onClick={() => setMoveResultModal(null)}
              style={{
                width: "100%",
                minHeight: "46px",
                marginTop: 12,
                borderRadius: "14px",
                border: "none",
                backgroundColor: "#2563EB",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {getFuriganaText("わかった")}
            </button>
          </div>
        </div>
      )}

      {showMergeTransition && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1800,
            background: "radial-gradient(circle at top, #dbeafe 0%, #eff6ff 40%, #f8fafc 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 18px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "-20% -10% auto -10%",
              height: "52%",
              background: "radial-gradient(circle, rgba(96,165,250,0.28) 0%, rgba(147,197,253,0.12) 42%, rgba(255,255,255,0) 72%)",
              pointerEvents: "none",
            }}
          />

          <div
            style={{
              position: "absolute",
              inset: "8% 8% auto",
              height: 210,
              borderRadius: 9999,
              background: `radial-gradient(circle, ${mergeAccentColor}30 0%, ${mergeAccentColor}10 48%, rgba(255,255,255,0) 74%)`,
              transform: `scale(${mergeStep === "mix" ? 1.12 : mergeStep === "sort" ? 1.04 : 1})`,
              opacity: mergeStep === "gather" ? 0.82 : 0.96,
              filter: "blur(6px)",
              transition: "all 1600ms ease",
              pointerEvents: "none",
            }}
          />

          <div style={{ position: "relative", zIndex: 2, textAlign: "center", maxWidth: "min(560px, 100%)" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 14px",
                marginBottom: 14,
                borderRadius: 9999,
                background: `${mergeAccentColor}18`,
                border: `2px solid ${mergeAccentColor}44`,
                color: mergeAccentColor,
                fontSize: "0.86rem",
                fontWeight: 900,
                letterSpacing: "0.12em",
                boxShadow: `0 8px 24px ${mergeAccentColor}20`,
              }}
            >
              {mergeStep === "gather"
                ? (
                    <>
                      <span>{mergeParticipantCount}</span>
                      <ruby style={{ rubyAlign: "center" }}>
                        人
                        <rt style={{ fontSize: "0.55em", lineHeight: 1, fontWeight: 700 }}>にん</rt>
                      </ruby>
                      <ruby style={{ rubyAlign: "center" }}>
                        分
                        <rt style={{ fontSize: "0.55em", lineHeight: 1, fontWeight: 700 }}>ぶん</rt>
                      </ruby>
                      <span>の カードを あつめてるよ</span>
                    </>
                  )
                : mergeStep === "mix"
                  ? "同じ色のカードを 合体してるよ"
                  : "4つのエリアへ いっせいに うごいてるよ"}
            </div>
            <div style={{ fontWeight: 900, fontSize: "1.35rem", color: "#0f172a", lineHeight: 1.35 }}>{mergeHeadline}</div>
            <div style={{ marginTop: 8, fontWeight: 900, fontSize: "0.96rem", color: "#334155", lineHeight: 1.5 }}>{mergeSubline}</div>
          </div>

          <div
            style={{
              position: "relative",
              zIndex: 2,
              width: "min(92vw, 560px)",
              height: "min(64vh, 520px)",
              marginTop: 20,
            }}
          >
            {MERGE_ZONE_ORDER.map((zone) => {
              const meta = mergeAreaMeta[zone];
              return (
                <div
                  key={`lane-${zone}`}
                  style={{
                    position: "absolute",
                    left: `${meta.left}%`,
                    top: `${meta.top}%`,
                    transform: "translate(-50%, -50%)",
                    width: "41%",
                    height: "34%",
                    borderRadius: 22,
                    border: `2px dashed ${meta.border}`,
                    backgroundColor: meta.bg,
                    boxShadow: mergeStep === "sort" ? `0 14px 32px ${meta.glow}` : "0 10px 22px rgba(15,23,42,0.06)",
                    opacity: mergeStep === "gather" ? 0.28 : mergeStep === "mix" ? 0.5 : 1,
                    transition: "all 2200ms ease",
                    padding: "14px 12px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ fontWeight: 900, fontSize: "0.9rem", color: "#0f172a", textAlign: "left", lineHeight: 1.35 }}>
                    {getFuriganaText(meta.title)}
                  </div>
                  <div style={{ fontWeight: 900, fontSize: "0.76rem", color: "#475569", lineHeight: 1.4 }}>
                    {zone === "want"
                      ? "みどりのカード"
                      : zone === "neutral"
                        ? "きいろのカード"
                        : zone === "dont"
                          ? "あかのカード"
                          : "グレーのカード"}
                  </div>
                </div>
              );
            })}

            <div
              style={{
                position: "absolute",
                left: "50%",
                top: mergeStep === "sort" ? "50%" : "48%",
                width: mergeStep === "mix" ? 188 : 138,
                height: mergeStep === "mix" ? 188 : 138,
                transform: "translate(-50%, -50%)",
                borderRadius: "50%",
                background:
                  mergeStep === "sort"
                    ? "radial-gradient(circle, rgba(148,163,184,0.22) 0%, rgba(255,255,255,0) 72%)"
                    : "radial-gradient(circle, rgba(59,130,246,0.20) 0%, rgba(255,255,255,0) 72%)",
                filter: "blur(4px)",
                transition: "all 2400ms ease",
                pointerEvents: "none",
              }}
            />

            {mergeCards.map((card, index) => {
              const zoneMeta = mergeAreaMeta[card.zone];

              const cardStyle: React.CSSProperties =
                mergeStep === "gather"
                  ? {
                      left: `${card.startX}%`,
                      top: `${card.startY}%`,
                      transform: `translate(-50%, -50%) rotate(${card.startRotate}deg)`,
                    }
                  : mergeStep === "mix"
                    ? {
                        left: `calc(50% + ${card.mixX}px)`,
                        top: `calc(48% + ${card.mixY}px)`,
                        transform: `translate(-50%, -50%) rotate(${card.mixRotate}deg) scale(1.06)`,
                      }
                    : {
                        left: `calc(${card.sortLeft}% + ${card.sortOffsetX}px)`,
                        top: `calc(${card.sortTop}% + ${card.sortOffsetY}px)`,
                        transform: "translate(-50%, -50%) rotate(0deg) scale(0.96)",
                      };

              return (
                <div
                  key={card.id}
                  style={{
                    position: "absolute",
                    width: 64,
                    height: 88,
                    borderRadius: 18,
                    background: mergeStep === "sort" ? zoneMeta.bg : "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                    border: `2px solid ${mergeStep === "sort" ? zoneMeta.border : `${zoneMeta.border}55`}`,
                    boxShadow: mergeStep === "sort" ? `0 14px 30px ${zoneMeta.glow}` : "0 16px 30px rgba(15,23,42,0.14)",
                    transition: "all 2600ms cubic-bezier(0.22, 1, 0.36, 1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: "1.45rem",
                    color: mergeStep === "sort" ? zoneMeta.border : "#0f172a",
                    ...cardStyle,
                  }}
                >
                  {card.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showDestinationReveal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1850,
            backgroundColor: "rgba(15,23,42,0.62)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            overflowY: "auto",
            overscrollBehavior: "contain",
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
              borderRadius: 24,
              padding: "18px 16px",
              boxShadow: "0 24px 70px rgba(15,23,42,0.28)",
              border: "2px solid rgba(22,163,74,0.18)",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: "1.45rem", color: "#0f172a", lineHeight: 1.35, textAlign: "center" }}>
              {getFuriganaText("今回行く場所はこちら！")}
            </div>
            <div style={{ marginTop: 8, fontWeight: 900, fontSize: "0.96rem", color: "#334155", lineHeight: 1.6, textAlign: "center" }}>
              {mergeDecisionSummary.goCards.length > 0
                ? getFuriganaText("行くカードが決まったよ！")
                : null}
            </div>

            {mergeDecisionSummary.goCards.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 16 }}>
                {mergeDecisionSummary.goCards.map(({ card }) => (
                  <div
                    key={card.id}
                    style={{
                      borderRadius: 18,
                      border: "2px solid #16a34a",
                      backgroundColor: "#f0fdf4",
                      padding: "12px 14px",
                      boxShadow: "0 12px 26px rgba(22,163,74,0.12)",
                    }}
                  >
                    <div style={{ fontWeight: 900, fontSize: "0.82rem", color: "#16a34a", marginBottom: 6 }}>
                      {getFuriganaText("行きたい")}
                    </div>
                    <div style={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.5 }}>{getCardTitleText(card.title)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                style={{
                  marginTop: 16,
                  borderRadius: 18,
                  border: "2px dashed #94a3b8",
                  backgroundColor: "#f8fafc",
                  padding: "18px 14px",
                  textAlign: "center",
                  fontWeight: 900,
                  color: "#475569",
                  lineHeight: 1.6,
                }}
              >
                {!hasLoadedSubmittedSelections
                  ? getFuriganaText("確認中...")
                  : getFuriganaText("行くカードはなかったみたいだ、、、！これは、、、！")}
              </div>
            )}

            <button
              onClick={proceedAfterDestinationReveal}
              style={{
                width: "100%",
                minHeight: 48,
                marginTop: 16,
                borderRadius: 16,
                border: "none",
                backgroundColor: mergeDecisionSummary.hasVs ? "#2563eb" : "#16a34a",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {mergeDecisionSummary.hasVs ? getFuriganaText("つぎへ") : getFuriganaText("結果を見る")}
            </button>
          </div>
        </div>
      )}

      {showMissionModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1860,
            background: "radial-gradient(circle at top, rgba(239,68,68,0.24), rgba(15,23,42,0.8) 58%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            animation: "missionAlertBackdropIn 320ms ease-out",
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              borderRadius: 24,
              backgroundColor: "#fff",
              padding: "20px 18px",
              boxShadow: "0 24px 70px rgba(15,23,42,0.35)",
              border: "3px solid #ef4444",
              textAlign: "center",
              animation: "missionModalPop 520ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: "clamp(1.8rem, 7vw, 2.5rem)", color: "#dc2626", lineHeight: 1.2 }}>
              {getFuriganaText("ミッション発生！")}
            </div>
            <div style={{ marginTop: 14, fontWeight: 900, fontSize: "1rem", color: "#334155", lineHeight: 1.7 }}>
              {getFuriganaText("意見が分かれてるカードをどうするか話し合おう！")}
            </div>
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {mergeDecisionSummary.vsCards.map(({ card }) => (
                <div
                  key={card.id}
                  style={{
                    borderRadius: 16,
                    border: "2px solid #64748b",
                    backgroundColor: "#f1f5f9",
                    padding: "10px 12px",
                    fontWeight: 900,
                    color: "#0f172a",
                    lineHeight: 1.5,
                    animation: "missionCardEnter 480ms ease-out both",
                  }}
                >
                  {getCardTitleText(card.title)}
                </div>
              ))}
            </div>
            <button
              onClick={openMissionDiscussion}
              style={{
                width: "100%",
                minHeight: 50,
                marginTop: 18,
                borderRadius: 16,
                border: "none",
                backgroundColor: "#dc2626",
                color: "#fff",
                fontWeight: 900,
                cursor: "pointer",
                animation: "missionButtonGlow 1400ms ease-in-out infinite",
              }}
            >
              {getFuriganaText("話し合いへ")}
            </button>
          </div>
        </div>
      )}

      {showMissionAlert && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1855,
            overflow: "hidden",
            background: "radial-gradient(circle at center, rgba(248,113,113,0.24) 0%, rgba(15,23,42,0.9) 72%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            animation: "missionAlertBackdropIn 220ms ease-out",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(248,113,113,0.18) 50%, rgba(15,23,42,0.02) 100%)",
            }}
          />

          {[0, 1, 2].map((ring) => (
            <div
              key={ring}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 160,
                height: 160,
                borderRadius: "50%",
                border: "2px solid rgba(248,113,113,0.55)",
                animation: `missionAlertRing 1100ms ease-out ${ring * 180}ms infinite`,
              }}
            />
          ))}

          <div
            style={{
              position: "relative",
              zIndex: 1,
              width: "min(500px, 100%)",
              borderRadius: 28,
              border: "2px solid rgba(248,113,113,0.46)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(254,242,242,0.98) 100%)",
              boxShadow: "0 28px 80px rgba(15,23,42,0.36)",
              padding: "28px 18px 24px",
              textAlign: "center",
              animation: "missionAlertCoreIn 500ms cubic-bezier(0.22, 1, 0.36, 1), missionAlertShake 520ms ease-in-out 620ms 1",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 128,
                minHeight: 46,
                padding: "8px 18px",
                borderRadius: 999,
                background: "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
                color: "#fff",
                fontWeight: 900,
                fontSize: "0.98rem",
                letterSpacing: "0.04em",
                animation: "missionBadgePulse 1000ms ease-in-out infinite",
              }}
            >
              VS ALERT
            </div>

            <div style={{ marginTop: 18, fontWeight: 900, fontSize: "clamp(1.6rem, 7vw, 2.4rem)", color: "#b91c1c", lineHeight: 1.2 }}>
              {getFuriganaText("ミッション発生！")}
            </div>
            <div style={{ marginTop: 12, fontWeight: 900, fontSize: "1rem", color: "#334155", lineHeight: 1.7 }}>
              {getFuriganaText("なにかがおこりそう...！")}
            </div>
            <div style={{ marginTop: 6, fontWeight: 900, fontSize: "0.95rem", color: "#475569", lineHeight: 1.7 }}>
              {getFuriganaText("VSのカードが見つかったよ！")}
            </div>

            <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
              {mergeDecisionSummary.vsCards.slice(0, 4).map((_, index) => (
                <div
                  key={`mission-alert-card-${index}`}
                  style={{
                    minWidth: 74,
                    maxWidth: 110,
                    minHeight: 96,
                    padding: "10px 10px",
                    borderRadius: 16,
                    border: "2px solid rgba(220,38,38,0.28)",
                    background:
                      index % 2 === 0
                        ? "linear-gradient(180deg, #ffffff 0%, #fef2f2 100%)"
                        : "linear-gradient(180deg, #fff1f2 0%, #ffffff 100%)",
                    color: "#7f1d1d",
                    fontWeight: 900,
                    boxShadow: "0 10px 24px rgba(239,68,68,0.14)",
                    animation: `missionCardEnter 420ms ease-out ${120 + index * 90}ms both`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: "1.25rem", letterSpacing: "0.08em" }}>VS</div>
                  <div
                    style={{
                      width: 34,
                      height: 6,
                      borderRadius: 999,
                      backgroundColor: "rgba(185,28,28,0.18)",
                    }}
                  />
                  <div style={{ fontSize: "0.74rem", lineHeight: 1.2, color: "#991b1b" }}>???</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
