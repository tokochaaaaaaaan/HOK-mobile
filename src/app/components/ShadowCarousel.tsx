// src/app/components/ShadowCarousel.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./ShadowCarousel.module.css";

export type Card = {
  id: string;
  src: string;
  title: string;
};

export default function ShadowCarousel({
  cards,
  radius = 160,
  initialSelectedIndex = 0,
  onSelect,
}: {
  cards: Card[];
  radius?: number;
  initialSelectedIndex?: number;
  onSelect: (index: number) => void;
}) {
  const carouselRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const count = cards.length;
  const angleStep = 360 / count;

  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startAngle = useRef(0);
  const [currentIndex, setCurrentIndex] = useState(initialSelectedIndex);
  const [totalRotation, setTotalRotation] = useState(initialSelectedIndex * angleStep);

  // カルーセルの transform を直接操作
  const applyTransform = (angle: number) => {
    if (!carouselRef.current) return;
    carouselRef.current.style.transform = `
      translate(-50%, -50%)
      translateZ(-${radius}px)
      rotateY(${-angle}deg)
    `;
  };

  // 指定のインデックスへスナップ（連続回転対応）
  const rotateToIndex = (idx: number) => {
    const normalized = ((idx % count) + count) % count;
    const currentNormalized = ((currentIndex % count) + count) % count;
    
    // 現在の角度から目標の角度への最短経路を計算
    let targetAngle = normalized * angleStep;
    const currentAngle = totalRotation;
    
    // 時計回りと反時計回りの距離を計算
    const clockwiseDistance = ((normalized - currentNormalized + count) % count) * angleStep;
    const counterClockwiseDistance = ((currentNormalized - normalized + count) % count) * angleStep;
    
    // より短い距離の方向を選択
    if (clockwiseDistance <= counterClockwiseDistance) {
      targetAngle = currentAngle + clockwiseDistance;
    } else {
      targetAngle = currentAngle - counterClockwiseDistance;
    }
    
    setCurrentIndex(normalized);
    setTotalRotation(targetAngle);
    applyTransform(targetAngle);
    onSelect(normalized);
  };

  // ドラッグ開始
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startX.current = e.clientX;
    startAngle.current = totalRotation;
    wrapperRef.current?.setPointerCapture(e.pointerId);
  };

  // ドラッグ中
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startX.current;
    const dragSpeed = 0.5;
    // ドラッグ方向と同じ向きに回転
    const newAngle = startAngle.current - dx * dragSpeed;
    applyTransform(newAngle);
  };

  // ドラッグ終了：最寄りインデックスにスナップ
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    wrapperRef.current?.releasePointerCapture(e.pointerId);
    const dx = e.clientX - startX.current;
    const dragSpeed = 0.5;
    const finalAngle = startAngle.current - dx * dragSpeed;
    const rawIndex = finalAngle / angleStep;
    const nearestIndex = Math.round(rawIndex);
    
    // 最も近いインデックスを正規化
    const normalizedIndex = ((nearestIndex % count) + count) % count;
    setCurrentIndex(normalizedIndex);
    setTotalRotation(nearestIndex * angleStep);
    applyTransform(nearestIndex * angleStep);
    onSelect(normalizedIndex);
  };

  // 初期位置に回転
  useEffect(() => {
    setTotalRotation(initialSelectedIndex * angleStep);
    rotateToIndex(initialSelectedIndex);
  }, [initialSelectedIndex]);

  return (
    <div
      className={styles.wrapper}
      ref={wrapperRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div ref={carouselRef} className={styles.carousel}>
        {cards.map((card, i) => {
          const theta = i * angleStep;
          const isActive = i === currentIndex;
          return (
            <div
              key={card.id}
              className={`${styles.card} ${isActive ? styles.activeCard : ""}`}
              style={{
                transform: `
                  translate(-50%, -50%)
                  rotateY(${theta}deg)
                  translateZ(${radius}px)
                `,
              }}
              onClick={() => rotateToIndex(i)}  // ← ここを追加
              title={card.title}
            >
              <img src={card.src} alt={card.title} />
            </div>
          );
        })}
      </div>
      <div className={styles.centerZone} />
    </div>
  );
}
