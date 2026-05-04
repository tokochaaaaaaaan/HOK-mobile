"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { usePreventBack } from "@/hooks/usePreventBack";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { activeCards } from "@/data/cards";
import { useUser } from "@/context/UserContext";
import MapButton from "@/components/MapButton";
import { getCardTitleText, getFuriganaText } from "@/components/FuriganaText";

type SwipeAction = "want" | "dont" | "neutral";

const actionMeta: Record<SwipeAction, { label: React.ReactNode; color: string; bg: string }> = {
  want: { label: getFuriganaText("行きたい"), color: "#166534", bg: "#dcfce7" },
  neutral: { label: "どちらでもいい", color: "#92400e", bg: "#fef3c7" },
  dont: { label: getFuriganaText("行きたくない"), color: "#991b1b", bg: "#fee2e2" },
};

const MIN_SWIPE_THRESHOLD_PX = 64;

function getActionCuePosition(action: SwipeAction): React.CSSProperties {
  return {
    left: "50%",
    top: "33%",
    transform: "translate(-50%, -50%)",
  };
}

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
  useBodyScrollLock(showHistory || showCardList);

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
  const swipeThreshold = Math.max(MIN_SWIPE_THRESHOLD_PX, Math.min(120, stageSize.w * 0.22));
  const swipeDownThreshold = Math.max(MIN_SWIPE_THRESHOLD_PX, Math.min(140, stageSize.h * 0.18));

  // PC向け：矢印キーで振り分け（←行きたくない / ↓どちらでもいい / →行きたい）
  useEffect(() => {
    if (typeof window === "undefined") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (!current) return;
      if (isAnimatingOut) return;
      if (outgoing) return;
      if (showHistory || showCardList) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        animateAndApply("dont");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        animateAndApply("neutral");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        animateAndApply("want");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, isAnimatingOut, outgoing, showHistory, showCardList]);

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

  const undoHistoryItem = (historyIndex: number) => {
    const target = history[historyIndex];
    if (!target) return;

    const card = initialDeck.find((c) => c.id === target.cardId);
    if (!card) return;

    setHistory((prev) => prev.filter((_, index) => index !== historyIndex));
    setRemaining((prev) => {
      if (prev.some((c) => c.id === card.id)) return prev;
      return [card, ...prev];
    });
    setIsBackSide(false);
    movedRef.current = false;
    startRef.current = null;
    isDraggingRef.current = false;
    setIsDragging(false);
    setIsAnimatingOut(null);
    setOutgoing(null);
    setOutgoingDelta(null);
    setDelta(0, 0);

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

      if (target.action === "want") removeOne(next["行きたい"], target.frontSrc);
      if (target.action === "neutral") removeOne(next["どちらでもいい"], target.frontSrc);
      if (target.action === "dont") removeOne(next["行きたくない"], target.frontSrc);
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
  const absDy = Math.abs(dy);
  const nextScale = 0.96 + Math.min(absDx / 900, 0.03);
  const nextLift = 10 - Math.min(absDx / 30, 10);
  const nextOpacity = 0.65 + Math.min(absDx / 220, 0.25);
  const actionButtonsDisabled = !current || !!isAnimatingOut || !!outgoing;
  const previewAction: SwipeAction | null = isAnimatingOut
    ? isAnimatingOut
    : absDx > absDy && absDx > 14
      ? dx > 0
        ? "want"
        : "dont"
      : dy > 14 && absDy > absDx
        ? "neutral"
        : null;
  const previewStrength = isAnimatingOut
    ? 1
    : previewAction === "neutral"
      ? Math.min(Math.max(dy, 0) / swipeDownThreshold, 1)
      : previewAction
        ? Math.min(absDx / swipeThreshold, 1)
        : 0;
  const previewMeta = previewAction ? actionMeta[previewAction] : null;
  const previewAccent = previewMeta
    ? previewAction === "want"
      ? `linear-gradient(135deg, rgba(34,197,94,${0.12 + previewStrength * 0.22}), rgba(134,239,172,${0.08 + previewStrength * 0.18}))`
      : previewAction === "dont"
        ? `linear-gradient(225deg, rgba(239,68,68,${0.12 + previewStrength * 0.22}), rgba(252,165,165,${0.08 + previewStrength * 0.18}))`
        : `linear-gradient(180deg, rgba(245,158,11,${0.12 + previewStrength * 0.22}), rgba(253,224,71,${0.08 + previewStrength * 0.18}))`
    : "transparent";
  const stageGlow = previewMeta
    ? `0 0 0 2px rgba(255,255,255,0.9), 0 20px 40px ${previewAction === "want" ? "rgba(34,197,94,0.24)" : previewAction === "dont" ? "rgba(239,68,68,0.22)" : "rgba(245,158,11,0.24)"}`
    : undefined;

  const listSelectedCard = useMemo(() => {
    if (listSelectedCardId == null) return null;
    return remaining.find((c) => c.id === listSelectedCardId) ?? null;
  }, [listSelectedCardId, remaining]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        backgroundColor: "#fff",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        // 画面上部を詰めて縦スクロールを減らす（右上固定ボタン分だけ確保）
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 56px)",
        paddingLeft: "16px",
        paddingRight: "16px",
        paddingBottom: "16px",
        boxSizing: "border-box",
      }}
    >
      {/* 右上：残りカード一覧 */}
      {current && (
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
          aria-label="残りカード一覧"
        >
          🗂️ {getFuriganaText("残りカード一覧")}
        </button>
      )}

      <div style={{ width: "100%", maxWidth: "460px" }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a", textAlign: "center", marginBottom: 6 }}>
          {getFuriganaText("カードを振り分けて旅行計画を立てていこう！")}
        </div>
        {/* カード領域 */}
        <div
          ref={stageRef}
          style={{
            width: "100%",
            aspectRatio: "3 / 4",
            maxHeight: "68dvh",
            borderRadius: "16px",
            backgroundColor: "#fff",
            position: "relative",
            overflow: "hidden",
            touchAction: "none",
            overscrollBehavior: "none",
            marginLeft: "auto",
            marginRight: "auto",
            boxShadow: stageGlow ?? "0 10px 30px rgba(0,0,0,0.12)",
            transition: isDragging || isAnimatingOut ? "box-shadow 80ms linear" : "box-shadow 180ms ease",
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
                    overflow: "hidden",
                  }}
                  aria-hidden
                >
                  <img
                    src={outgoing.src}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    draggable={false}
                  />
                  {isAnimatingOut && (
                    <>
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: previewAccent,
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          ...getActionCuePosition(isAnimatingOut),
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: `2px solid ${actionMeta[isAnimatingOut].color}`,
                          backgroundColor: "rgba(255,255,255,0.95)",
                          color: actionMeta[isAnimatingOut].color,
                          fontWeight: 900,
                          fontSize: "0.95rem",
                          boxShadow: "0 8px 24px rgba(15,23,42,0.15)",
                        }}
                      >
                        {actionMeta[isAnimatingOut].label}
                      </div>
                    </>
                  )}
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
                  overflow: "hidden",
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

                {previewMeta && previewStrength > 0 && (
                  <>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: previewAccent,
                        opacity: 0.75,
                        transition: isDragging ? "none" : "opacity 160ms ease",
                        pointerEvents: "none",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        ...getActionCuePosition(previewAction as SwipeAction),
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: `2px solid ${previewMeta.color}`,
                        backgroundColor: "rgba(255,255,255,0.96)",
                        color: previewMeta.color,
                        fontWeight: 900,
                        fontSize: "0.95rem",
                        boxShadow: "0 8px 24px rgba(15,23,42,0.15)",
                        opacity: 0.7 + previewStrength * 0.3,
                        transform: `translate(-50%, -50%) scale(${0.92 + previewStrength * 0.08})`,
                        transition: isDragging ? "none" : "all 160ms ease",
                        pointerEvents: "none",
                      }}
                    >
                      {previewMeta.label}
                    </div>
                  </>
                )}

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
              {getFuriganaText("すべて振り分けました")}
            </div>
          )}
        </div>

        {/* スワイプでもボタンでも振り分け可能 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.92fr 1.16fr 0.92fr",
            gap: 8,
            marginTop: 8,
            alignItems: "center",
          }}
          aria-label="振り分けボタン"
        >
          <button
            type="button"
            onClick={() => animateAndApply("dont")}
            disabled={actionButtonsDisabled}
            style={{
              position: "relative",
              borderRadius: 12,
              border: `1px solid ${actionMeta.dont.color}`,
              background: actionMeta.dont.bg,
              color: actionMeta.dont.color,
              fontWeight: 900,
              fontSize: 12,
              padding: "8px 28px 8px 10px",
              textAlign: "center",
              whiteSpace: "nowrap",
              cursor: actionButtonsDisabled ? "not-allowed" : "pointer",
              opacity: actionButtonsDisabled ? 0.55 : 1,
              justifySelf: "end",
              width: "100%",
              maxWidth: "128px",
            }}
            aria-label="行きたくないに振り分ける"
          >
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>←</span>
            <span style={{ display: "block", width: "100%", textAlign: "center", transform: "translateX(14px)" }}>
              {getFuriganaText("行きたくない")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => animateAndApply("neutral")}
            disabled={actionButtonsDisabled}
            style={{
              borderRadius: 12,
              border: `1px solid ${actionMeta.neutral.color}`,
              background: actionMeta.neutral.bg,
              color: actionMeta.neutral.color,
              fontWeight: 900,
              fontSize: 12,
              padding: "8px 10px",
              textAlign: "center",
              whiteSpace: "nowrap",
              cursor: actionButtonsDisabled ? "not-allowed" : "pointer",
              opacity: actionButtonsDisabled ? 0.55 : 1,
              width: "100%",
            }}
            aria-label="どちらでもいいに振り分ける"
          >
            ↓ どちらでもいい
          </button>
          <button
            type="button"
            onClick={() => animateAndApply("want")}
            disabled={actionButtonsDisabled}
            style={{
              position: "relative",
              borderRadius: 12,
              border: `1px solid ${actionMeta.want.color}`,
              background: actionMeta.want.bg,
              color: actionMeta.want.color,
              fontWeight: 900,
              fontSize: 12,
              padding: "8px 10px 8px 28px",
              textAlign: "center",
              whiteSpace: "nowrap",
              cursor: actionButtonsDisabled ? "not-allowed" : "pointer",
              opacity: actionButtonsDisabled ? 0.55 : 1,
              justifySelf: "start",
              width: "100%",
              maxWidth: "128px",
            }}
            aria-label="行きたいに振り分ける"
          >
            <span style={{ display: "block", width: "100%", textAlign: "center", transform: "translateX(-8px)" }}>
              {getFuriganaText("行きたい")}
            </span>
            <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>→</span>
          </button>
        </div>

        {/* 操作ボタン（カードの下） */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "10px",
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
            {getFuriganaText("戻す")}
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

        {/* 全て処理済みなら中央の同一レイヤーに操作を集約 */}
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
            <div
              style={{
                width: "min(420px, 100%)",
                display: "grid",
                gap: "12px",
              }}
            >
              <button
                onClick={() => router.push(`/room/${roomId}/mobile2`)}
                style={{
                  width: "100%",
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
                {getFuriganaText("次のページへ")}
              </button>

              <button
                onClick={undoLast}
                disabled={!history.length || !!isAnimatingOut}
                style={{
                  width: "100%",
                  minHeight: "56px",
                  borderRadius: "14px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: !history.length || isAnimatingOut ? "#e2e8f0" : "#fff",
                  color: "#0f172a",
                  fontWeight: 900,
                  fontSize: "1.05rem",
                  cursor: !history.length || isAnimatingOut ? "not-allowed" : "pointer",
                  boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
                }}
              >
                {getFuriganaText("戻す")}
              </button>

              <button
                onClick={() => setShowHistory(true)}
                style={{
                  width: "100%",
                  minHeight: "52px",
                  borderRadius: "14px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "rgba(255,255,255,0.96)",
                  color: "#0f172a",
                  fontWeight: 900,
                  fontSize: "1rem",
                  cursor: "pointer",
                  boxShadow: "0 10px 22px rgba(15,23,42,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
                aria-label="履歴"
                title="履歴"
              >
                <span aria-hidden>🕘</span>
                <span>{getFuriganaText("履歴")}</span>
              </button>
            </div>
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
            overflowY: "auto",
            overscrollBehavior: "contain",
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
              <div>{getFuriganaText("履歴")}</div>
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
                {getFuriganaText("閉じる")}
              </button>
            </div>
            <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              {history.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {history
                    .slice()
                    .reverse()
                    .map((h, idx) => {
                      const card = initialDeck.find((c) => c.id === h.cardId);
                      const historyIndex = history.length - 1 - idx;
                      return (
                        <div
                          key={`${h.cardId}-${history.length - idx}`}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            border: "1px solid #e2e8f0",
                            borderRadius: "12px",
                            padding: "10px 12px",
                            backgroundColor: "#fff",
                            gap: "12px",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
                              {card ? getCardTitleText(card.title) : `カード${h.cardId}`}
                            </div>
                            <div style={{ marginTop: 8, fontWeight: 900, color: "#0f172a" }}>
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
                          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                            <button
                              onClick={() => {
                                undoHistoryItem(historyIndex);
                                setShowHistory(false);
                              }}
                              disabled={!!isAnimatingOut}
                              style={{
                                minHeight: "36px",
                                padding: "0 12px",
                                borderRadius: "10px",
                                border: "1px solid #cbd5e1",
                                backgroundColor: isAnimatingOut ? "#e2e8f0" : "#fff",
                                cursor: isAnimatingOut ? "not-allowed" : "pointer",
                                fontWeight: 900,
                                color: "#0f172a",
                              }}
                            >
                              {getFuriganaText("戻す")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <div style={{ color: "#475569", fontWeight: 700 }}>{getFuriganaText("まだ履歴がありません")}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 残りカード一覧モーダル */}
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
            overflowY: "auto",
            overscrollBehavior: "contain",
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
              <div>{getFuriganaText("残りカード一覧")}</div>
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
                {getFuriganaText("閉じる")}
              </button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "12px", backgroundColor: "#f8fafc", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${viewportW < 420 ? 2 : 3}, minmax(0, 1fr))`,
                  gap: "10px",
                }}
              >
                {remaining.map((c) => (
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
                      {getCardTitleText(c.title)}
                    </div>
                  </button>
                ))}
              </div>
              {remaining.length === 0 && (
                <div style={{ marginTop: 12, fontWeight: 900, color: "#64748b", textAlign: "center" }}>
                  すべて振り分けました
                </div>
              )}
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
                  onClick={() => setListIsBackSide((v) => !v)}
                  style={{
                    width: "100%",
                    height: "100%",
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

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setListSelectedCardId(null);
                        setListIsBackSide(false);
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
        </div>
      )}
    </div>
  );
}
