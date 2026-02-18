"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { activeCards, CardData } from "@/data/cards";
import { useUser } from "@/context/UserContext";
import MapButton from "@/components/MapButton";
import { addAuthKey } from "../../../../../lib/firebase-auth";
import { db } from "../../../../../lib/firebase";
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc } from "firebase/firestore";

type AreaKey = "行きたい" | "どちらでもいい" | "行きたくない";

type Mode = "view" | "note" | "move";

const areaMeta: Record<AreaKey, { title: string; border: string; bg: string; noteBg: string; noteColor: string }> = {
  行きたい: { title: "行きたい", border: "#16a34a", bg: "#f0fdf4", noteBg: "#dcfce7", noteColor: "#166534" },
  "どちらでもいい": { title: "どちらでもいい", border: "#f59e0b", bg: "#fffbeb", noteBg: "#fef3c7", noteColor: "#92400e" },
  行きたくない: { title: "行きたくない", border: "#ef4444", bg: "#fef2f2", noteBg: "#fee2e2", noteColor: "#991b1b" },
};

const AREA_KEYS: AreaKey[] = ["行きたい", "どちらでもいい", "行きたくない"];

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

  const [selectedFrontSrc, setSelectedFrontSrc] = useState<string | null>(null);
  const [selectedIsBack, setSelectedIsBack] = useState(false);

  const [notes, setNotes] = useState<Record<string, { text: string }>>({});
  const [editingNote, setEditingNote] = useState<null | { frontSrc: string; area: AreaKey }>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const [movePicker, setMovePicker] = useState<null | { frontSrc: string; fromArea: AreaKey }>(null);
  const [moveToast, setMoveToast] = useState<string | null>(null);
  const moveToastTimerRef = useRef<number | null>(null);

  const [showDiscussionConfirm, setShowDiscussionConfirm] = useState(false);
  const [discussionSubmitting, setDiscussionSubmitting] = useState(false);
  const [discussionError, setDiscussionError] = useState<string | null>(null);
  const [expectedUserNames, setExpectedUserNames] = useState<string[]>([]);
  const [discussionReadyMap, setDiscussionReadyMap] = useState<Record<string, boolean>>({});
  const [selfDiscussionReady, setSelfDiscussionReady] = useState(false);

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
    setNoteDraft(existing);
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
      setNoteDraft("");
    }
  };

  const saveNote = () => {
    if (!editingNote) return;
    const key = editingNote.frontSrc;
    const trimmed = noteDraft.trim();
    if (!trimmed) {
      setNotes((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setNotes((prev) => ({ ...prev, [key]: { text: trimmed } }));
    }
    setEditingNote(null);
    setNoteDraft("");
  };

  const cancelNote = () => {
    setEditingNote(null);
    setNoteDraft("");
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

    const title = cardsByFrontSrc.get(frontSrc)?.title ?? "カード";
    const msg = `${title}が${toArea}に移動しました`;
    setMoveToast(msg);
    if (moveToastTimerRef.current) window.clearTimeout(moveToastTimerRef.current);
    moveToastTimerRef.current = window.setTimeout(() => {
      setMoveToast(null);
      moveToastTimerRef.current = null;
    }, 1600);
  };

  const onCardTap = (frontSrc: string, area: AreaKey) => {
    if (mode === "note") {
      const t = notes[frontSrc]?.text?.trim() ?? "";
      if (t.length > 0) {
        removeNote(frontSrc);
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

  useEffect(() => {
    if (!selfDiscussionReady) return;
    if (!roomId || typeof roomId !== "string") return;
    if (expectedCount >= 1 && readyCount === expectedCount && readyCount > 0) {
      router.push(`/room/${roomId}/mobile3`);
    }
  }, [selfDiscussionReady, expectedCount, readyCount, roomId, router]);

  const submitAndReadyForDiscussion = async () => {
    if (!roomId || typeof roomId !== "string") throw new Error("roomIdが不正です");
    if (!userName || !userName.trim()) throw new Error("名前が未設定です");

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
      {moveToast && (
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
          {moveToast}
        </div>
      )}
      <div style={{ width: "100%", maxWidth: "560px", fontFamily: "Arial, sans-serif" }}>
        <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#0f172a", marginBottom: 12 }}>
          振り分け結果
        </div>

        <div
          style={{
            fontWeight: 900,
            color: "#334155",
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          付箋をつけてなぜそう思うのか表現してみよう！
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
                {meta.title}（{list.length}）
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
                              removeNote(frontSrc);
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
                          <div style={{ fontSize: "0.62rem", opacity: 0.85, letterSpacing: "0.02em" }}>付箋</div>
                          <div
                            style={{
                              marginTop: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {noteText}
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
            🏷️ 付箋を付ける/外す
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
            ↔︎ カード移動
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
            議論へ
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
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#0f172a" }}>最終確認</div>
            <div style={{ fontWeight: 900, color: "#334155", lineHeight: 1.6 }}>
              個人の考えの整理はここで終了です。良いですか？
            </div>

            {discussionError && (
              <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 900, lineHeight: 1.5 }}>{discussionError}</div>
            )}

            {selfDiscussionReady && (
              <div style={{ marginTop: 10, fontWeight: 900, color: "#0f172a" }}>
                他の参加者を待っています…（{readyCount} / {expectedCount || "?"}）
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
              閉じる
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
            <div style={{ fontWeight: 900, marginBottom: 8, color: "#0f172a" }}>理由（付箋）</div>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="理由を入力"
              style={{
                width: "100%",
                minHeight: "96px",
                borderRadius: "12px",
                border: "1px solid rgba(15,23,42,0.18)",
                padding: "10px 12px",
                fontSize: "16px",
                lineHeight: 1.5,
                boxSizing: "border-box",
              }}
            />
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
                style={{
                  flex: 1,
                  minHeight: "46px",
                  borderRadius: "14px",
                  border: "none",
                  backgroundColor: "#2563EB",
                  color: "#fff",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                保存
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
            <div style={{ fontWeight: 900, marginBottom: 10, color: "#0f172a" }}>移動先を選択</div>
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
                    {meta.title}
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
              閉じる
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
