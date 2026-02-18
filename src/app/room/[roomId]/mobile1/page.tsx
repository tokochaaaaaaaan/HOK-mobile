"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { activeCards } from "@/data/cards";
import { useUser } from "@/context/UserContext";
import MapButton from "@/components/MapButton";

type SwipeAction = "want" | "dont" | "neutral";

const actionMeta: Record<SwipeAction, { label: string; color: string; bg: string }> = {
  want: { label: "行きたい", color: "#166534", bg: "#dcfce7" },
  neutral: { label: "どちらでもいい", color: "#92400e", bg: "#fef3c7" },
  dont: { label: "行きたくない", color: "#991b1b", bg: "#fee2e2" },
};

const MIN_SWIPE_THRESHOLD_PX = 64;

export default function Mobile1Page() {
  const { roomId } = useParams();
  const router = useRouter();
  const { setCardPositions } = useUser();

  const initialDeck = useMemo(() => activeCards, []);
  const [remaining, setRemaining] = useState(initialDeck);
  const [history, setHistory] = useState<Array<{ action: SwipeAction; cardId: number; frontSrc: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCardList, setShowCardList] = useState(false);
  const [listSelectedCardId, setListSelectedCardId] = useState<number | null>(null);
  const [listIsBackSide, setListIsBackSide] = useState(false);
  const [isBackSide, setIsBackSide] = useState(false);

  const [viewportW, setViewportW] = useState(375);

  const [dx, setDx] = useState(0);
  const [dy, setDy] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState<null | SwipeAction>(null);
  const [outgoing, setOutgoing] = useState<null | { src: string }>(null);
  const [outgoingDelta, setOutgoingDelta] = useState<null | { dx: number; dy: number }>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const dxRef = useRef(0);
  const dyRef = useRef(0);
  const isDraggingRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 360, h: 480 });

  // ブラウザの戻るボタンを無効化
  usePreventBack();

  useEffect(() => {
    if (!roomId || typeof roomId !== "string") return;
  }, [roomId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => setViewportW(window.innerWidth || 375);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // モーダル表示中は背景スクロールを抑止（スマホ向け）
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!showCardList) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [showCardList]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ w: rect.width, h: rect.height });
      }
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const current = remaining[0] ?? null;
  const lastAction = history.length ? history[history.length - 1].action : null;

  const setDelta = (nextDx: number, nextDy: number) => {
    dxRef.current = nextDx;
    dyRef.current = nextDy;
    setDx(nextDx);
    setDy(nextDy);
  };

  const endGesture = () => {
    if (!isDraggingRef.current || !startRef.current || !current || isAnimatingOut) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    startRef.current = null;

    const localDx = dxRef.current;
    const localDy = dyRef.current;
    const absX = Math.abs(localDx);
    const absY = Math.abs(localDy);
    const swipeThreshold = Math.max(MIN_SWIPE_THRESHOLD_PX, Math.min(120, stageSize.w * 0.22));
    const swipeDownThreshold = Math.max(MIN_SWIPE_THRESHOLD_PX, Math.min(140, stageSize.h * 0.18));

    if (absX >= swipeThreshold && absX > absY) {
      animateAndApply(localDx > 0 ? "want" : "dont");
      return;
    }

    if (localDy >= swipeDownThreshold && absY > absX) {
      animateAndApply("neutral");
      return;
    }

    if (!movedRef.current) {
      setDelta(0, 0);
      setIsBackSide((v) => !v);
      return;
    }

    setDelta(0, 0);
  };

  const beginGesture = (x: number, y: number) => {
    if (!current || isAnimatingOut || outgoing) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    startRef.current = { x, y };
    movedRef.current = false;
    setDelta(0, 0);
  };

  const moveGesture = (x: number, y: number) => {
    if (!isDraggingRef.current || !startRef.current || !current || isAnimatingOut) return;
    const ndx = x - startRef.current.x;
    const ndy = y - startRef.current.y;
    if (Math.abs(ndx) + Math.abs(ndy) > 6) movedRef.current = true;
    setDelta(ndx, ndy);
  };

  const applyAction = (action: SwipeAction, cardOverride?: (typeof remaining)[number]) => {
    const card = cardOverride ?? remaining[0];
    if (!card) return;

    setHistory((prev) => [...prev, { action, cardId: card.id, frontSrc: card.frontSrc }]);
    setRemaining((prev) => {
      if (!prev.length) return prev;
      if (prev[0]?.id === card.id) return prev.slice(1);
      return prev.filter((c) => c.id !== card.id);
    });
    setIsBackSide(false);
    movedRef.current = false;
    startRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);

    setCardPositions((prev) => {
      const next = {
        ...prev,
        行きたい: [...(prev["行きたい"] || [])],
        "どちらでもいい": [...(prev["どちらでもいい"] || [])],
        行きたくない: [...(prev["行きたくない"] || [])],
      } as Record<string, string[]>;

      if (action === "want") next["行きたい"].push(card.frontSrc);
      if (action === "neutral") next["どちらでもいい"].push(card.frontSrc);
      if (action === "dont") next["行きたくない"].push(card.frontSrc);
      return next;
    });
  };

  const animateAndApply = (action: SwipeAction) => {
    if (!current || isAnimatingOut || outgoing) return;
    setIsAnimatingOut(action);

    // 次カードが先に前へ来るように：スワイプしたカードはoverlayとして残して外へ
    const leavingSrc = isBackSide ? current.backSrc : current.frontSrc;
    setOutgoing({ src: leavingSrc });
    setOutgoingDelta({ dx: dxRef.current, dy: dyRef.current });

    // デッキを即進める（次のカードが前面に）
    applyAction(action, current);
    setDelta(0, 0);

    // overlayを画面外へ
    const outDx =
      action === "want" ? stageSize.w * 1.25 : action === "dont" ? -stageSize.w * 1.25 : 0;
    const outDy = action === "neutral" ? stageSize.h * 1.25 : 0;
    requestAnimationFrame(() => {
      setOutgoingDelta({ dx: outDx, dy: outDy });
    });

    window.setTimeout(() => {
      setOutgoing(null);
      setOutgoingDelta(null);
      setIsAnimatingOut(null);
    }, 220);
  };

  const undoLast = () => {
    const last = history[history.length - 1];
    if (!last) return;

    const card = initialDeck.find((c) => c.id === last.cardId);
    if (!card) return;

    setHistory((prev) => prev.slice(0, -1));
    setRemaining((prev) => [card, ...prev]);
    setIsBackSide(false);

    setCardPositions((prev) => {
      const next = {
        ...prev,
        行きたい: [...(prev["行きたい"] || [])],
        "どちらでもいい": [...(prev["どちらでもいい"] || [])],
        行きたくない: [...(prev["行きたくない"] || [])],
      } as Record<string, string[]>;

      const removeOne = (arr: string[], value: string) => {
        const idx = arr.lastIndexOf(value);
        if (idx >= 0) arr.splice(idx, 1);
      };

      if (last.action === "want") removeOne(next["行きたい"], last.frontSrc);
      if (last.action === "neutral") removeOne(next["どちらでもいい"], last.frontSrc);
      if (last.action === "dont") removeOne(next["行きたくない"], last.frontSrc);
      return next;
    });
  };

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    beginGesture(e.clientX, e.clientY);
    (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    moveGesture(e.clientX, e.clientY);
  };

  const onPointerUp: React.PointerEventHandler<HTMLDivElement> = () => {
    endGesture();
  };

  const onTouchStart: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const t = e.touches[0];
    if (!t) return;
    beginGesture(t.clientX, t.clientY);
  };

  const onTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    const t = e.touches[0];
    if (!t) return;
    if (e.cancelable) e.preventDefault();
    moveGesture(t.clientX, t.clientY);
  };

  const onTouchEnd: React.TouchEventHandler<HTMLDivElement> = () => {
    endGesture();
  };

  const cardTransform = `translate3d(${dx}px, ${dy}px, 0) rotate(${dx / 18}deg)`;
  const cardTransition = isDragging ? "none" : "transform 180ms ease";

  const nextCard = remaining[1] ?? null;
  const absDx = Math.abs(dx);
  const nextScale = 0.96 + Math.min(absDx / 900, 0.03);
  const nextLift = 10 - Math.min(absDx / 30, 10);
  const nextOpacity = 0.65 + Math.min(absDx / 220, 0.25);

  const listSelectedCard = useMemo(() => {
    if (listSelectedCardId == null) return null;
    return initialDeck.find((c) => c.id === listSelectedCardId) ?? null;
  }, [listSelectedCardId, initialDeck]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        backgroundColor: "#fff",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 72px)",
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingBottom: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* 右上：カード一覧 */}
      <button
        onClick={() => {
          setShowCardList(true);
          setListSelectedCardId(null);
          setListIsBackSide(false);
        }}
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: "16px",
          zIndex: 1200,
          minHeight: "40px",
          padding: "0 12px",
          borderRadius: "12px",
          border: "1px solid rgba(15,23,42,0.14)",
          backgroundColor: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(8px)",
          color: "#0f172a",
          fontWeight: 900,
          cursor: "pointer",
          boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
        }}
        aria-label="カード一覧"
      >
        🗂️ カード一覧
      </button>

      <div style={{ width: "100%", maxWidth: "460px" }}>
        {/* カード領域 */}
        <div
          ref={stageRef}
          style={{
            width: "100%",
            aspectRatio: "3 / 4",
            maxHeight: "72dvh",
            borderRadius: "16px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.12)",
            backgroundColor: "#fff",
            position: "relative",
            overflow: "hidden",
            touchAction: "none",
            overscrollBehavior: "none",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {current ? (
            <>
              {/* フリックで外へ出るカード（overlay） */}
              {outgoing && outgoingDelta && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 30,
                    transform: `translate3d(${outgoingDelta.dx}px, ${outgoingDelta.dy}px, 0) rotate(${outgoingDelta.dx / 18}deg)`,
                    transition: "transform 200ms ease",
                    willChange: "transform",
                    backgroundColor: "#f1f5f9",
                  }}
                  aria-hidden
                >
                  <img
                    src={outgoing.src}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    draggable={false}
                  />
                </div>
              )}

              {/* 次のカード（背面） */}
              {nextCard && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transform: `scale(${nextScale}) translate3d(0, ${nextLift}px, 0)`,
                    transition: isDragging ? "none" : "transform 180ms ease",
                    opacity: nextOpacity,
                    filter: "saturate(0.95)",
                    backgroundColor: "#f1f5f9",
                    zIndex: 10,
                  }}
                  aria-hidden
                >
                  <img
                    src={nextCard.frontSrc}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    draggable={false}
                  />
                </div>
              )}

              {/* 現在のカード（前面） */}
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
                onTouchCancel={onTouchEnd}
                style={{
                  width: "100%",
                  height: "100%",
                  transform: cardTransform,
                  transition: cardTransition,
                  willChange: "transform",
                  userSelect: "none",
                  position: "relative",
                  perspective: "1000px",
                  zIndex: 20,
                }}
                aria-label="カードをフリック（タップで裏面）"
              >
                {/* 表裏（タップでくるっと回転） */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    transformStyle: "preserve-3d",
                    transition: isDragging ? "none" : "transform 260ms ease",
                    transform: `rotateY(${isBackSide ? 180 : 0}deg)`,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backfaceVisibility: "hidden",
                      backgroundColor: "#f1f5f9",
                    }}
                  >
                    <img
                      src={current.frontSrc}
                      alt={current.title}
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
                      backgroundColor: "#f1f5f9",
                    }}
                  >
                    <img
                      src={current.backSrc}
                      alt={current.title}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      draggable={false}
                    />
                  </div>
                </div>

                {/* 残り */}
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    backgroundColor: "rgba(0,0,0,0.55)",
                    color: "#fff",
                    fontSize: "0.85rem",
                    fontWeight: 800,
                  }}
                >
                  {remaining.length} / {initialDeck.length}
                </div>
              </div>
            </>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0f172a",
                fontWeight: 800,
              }}
            >
              すべて振り分けました
            </div>
          )}
        </div>

        {/* 操作ボタン（カードの下） */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "12px",
          }}
        >
          <button
            onClick={undoLast}
            disabled={!history.length || !!isAnimatingOut}
            style={{
              flex: 1,
              minHeight: "44px",
              borderRadius: "12px",
              border: "1px solid #cbd5e1",
              backgroundColor: !history.length || isAnimatingOut ? "#e2e8f0" : "#fff",
              color: "#0f172a",
              fontWeight: 900,
              cursor: !history.length || isAnimatingOut ? "not-allowed" : "pointer",
              padding: "10px 12px",
            }}
          >
            戻す
          </button>

          <div
            style={
              {
                display: "flex",
                alignItems: "stretch",
                justifyContent: "center",
                "--map-btn-size": "44px",
                "--map-btn-radius": "12px",
              } as any
            }
            aria-label="マップ"
            title="マップ"
          >
            <MapButton variant="inline" showLabel={false} />
          </div>

          <button
            onClick={() => setShowHistory(true)}
            style={{
              width: "56px",
              minHeight: "44px",
              borderRadius: "12px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#fff",
              cursor: "pointer",
              fontSize: "1.1rem",
              fontWeight: 900,
            }}
            aria-label="履歴"
            title="履歴"
          >
            🕘
          </button>
        </div>

        {/* 全て処理済みなら中央に「次のページへ」 */}
        {!current && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
              backgroundColor: "rgba(255,255,255,0.75)",
              backdropFilter: "blur(2px)",
            }}
          >
            <button
              onClick={() => router.push(`/room/${roomId}/mobile2`)}
              style={{
                width: "min(420px, 100%)",
                minHeight: "56px",
                borderRadius: "14px",
                border: "none",
                backgroundColor: "#2563EB",
                color: "#fff",
                fontWeight: 900,
                fontSize: "1.1rem",
                cursor: "pointer",
                boxShadow: "0 10px 22px rgba(37,99,235,0.35)",
              }}
            >
              次のページへ
            </button>
          </div>
        )}
      </div>

      {/* 履歴モーダル */}
      {showHistory && (
        <div
          onClick={() => setShowHistory(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "520px",
              maxHeight: "80dvh",
              backgroundColor: "#fff",
              borderRadius: "16px",
              overflow: "hidden",
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
                borderBottom: "1px solid #e2e8f0",
                fontWeight: 900,
              }}
            >
              <div>履歴</div>
              <button
                onClick={() => setShowHistory(false)}
                style={{
                  minHeight: "36px",
                  padding: "0 12px",
                  borderRadius: "10px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                閉じる
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 14px" }}>
              {history.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {history
                    .slice()
                    .reverse()
                    .map((h, idx) => {
                      const card = initialDeck.find((c) => c.id === h.cardId);
                      return (
                        <div
                          key={`${h.cardId}-${history.length - idx}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            border: "1px solid #e2e8f0",
                            borderRadius: "12px",
                            padding: "10px 12px",
                            backgroundColor: "#fff",
                          }}
                        >
                          <div style={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
                            {card?.title ?? `カード${h.cardId}`}
                          </div>
                          <div style={{ fontWeight: 900, color: "#0f172a" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "6px 10px",
                                borderRadius: "999px",
                                backgroundColor: actionMeta[h.action].bg,
                                color: actionMeta[h.action].color,
                                fontWeight: 900,
                                fontSize: "0.9rem",
                              }}
                            >
                              {actionMeta[h.action].label}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div style={{ color: "#475569", fontWeight: 700 }}>まだ履歴がありません</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* カード一覧モーダル */}
      {showCardList && (
        <div
          onClick={() => {
            setShowCardList(false);
            setListSelectedCardId(null);
            setListIsBackSide(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
            padding: "16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: "720px",
              maxHeight: "90dvh",
              backgroundColor: "#fff",
              borderRadius: "16px",
              overflow: "hidden",
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
                borderBottom: "1px solid #e2e8f0",
                fontWeight: 900,
              }}
            >
              <div>カード一覧</div>
              <button
                onClick={() => {
                  setShowCardList(false);
                  setListSelectedCardId(null);
                  setListIsBackSide(false);
                }}
                style={{
                  minHeight: "36px",
                  padding: "0 12px",
                  borderRadius: "10px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                閉じる
              </button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "12px", backgroundColor: "#f8fafc" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${viewportW < 420 ? 2 : 3}, minmax(0, 1fr))`,
                  gap: "10px",
                }}
              >
                {initialDeck.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setListSelectedCardId(c.id);
                      setListIsBackSide(false);
                    }}
                    style={{
                      border: "1px solid rgba(15,23,42,0.10)",
                      borderRadius: "12px",
                      overflow: "hidden",
                      backgroundColor: "#fff",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    aria-label={`${c.title}を表示`}
                  >
                    <div style={{ width: "100%", aspectRatio: "3 / 4", backgroundColor: "#f1f5f9" }}>
                      <img
                        src={c.frontSrc}
                        alt={c.title}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                        draggable={false}
                      />
                    </div>
                    <div style={{ padding: "8px 10px", fontWeight: 900, fontSize: 12, color: "#0f172a", lineHeight: 1.25 }}>
                      {c.title}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 選択カードのプレビュー（表裏タップ） */}
          {listSelectedCard && (
            <div
              onClick={() => {
                setListSelectedCardId(null);
                setListIsBackSide(false);
              }}
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(15,23,42,0.68)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1300,
                padding: "16px",
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "min(520px, 100%)",
                  backgroundColor: "#fff",
                  borderRadius: "16px",
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
                    borderBottom: "1px solid #e2e8f0",
                    fontWeight: 900,
                  }}
                >
                  <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{listSelectedCard.title}</div>
                  <button
                    onClick={() => {
                      setListSelectedCardId(null);
                      setListIsBackSide(false);
                    }}
                    style={{
                      minHeight: "36px",
                      padding: "0 12px",
                      borderRadius: "10px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#fff",
                      cursor: "pointer",
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    閉じる
                  </button>
                </div>

                <div
                  onClick={() => setListIsBackSide((v) => !v)}
                  style={{
                    width: "100%",
                    aspectRatio: "3 / 4",
                    backgroundColor: "#f1f5f9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    position: "relative",
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="タップで表裏を切り替え"
                >
                  <img
                    src={listIsBackSide ? listSelectedCard.backSrc : listSelectedCard.frontSrc}
                    alt={listSelectedCard.title}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    draggable={false}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 10,
                      left: 10,
                      padding: "8px 10px",
                      borderRadius: "12px",
                      backgroundColor: "rgba(0,0,0,0.55)",
                      color: "#fff",
                      fontWeight: 900,
                      fontSize: 12,
                    }}
                  >
                    タップで{listIsBackSide ? "表" : "裏"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
