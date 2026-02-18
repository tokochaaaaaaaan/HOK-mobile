"use client";

import React, { useState } from "react";
import styles from "./MapButton.module.css";

type MapButtonProps = {
  variant?: "floating" | "inline";
  showLabel?: boolean;
};

export default function MapButton({ variant = "floating", showLabel }: MapButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const shouldShowLabel = showLabel ?? variant === "floating";
  const iconSize = variant === "inline" ? 24 : 28;

  return (
    <>
      {/* フローティングマップボタン */}
      <button
        className={variant === "floating" ? styles.floatingButton : styles.inlineButton}
        onClick={() => setIsOpen(true)}
        aria-label="マップを表示"
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </svg>
        {shouldShowLabel && <span className={styles.buttonText}>マップ</span>}
      </button>

      {/* マップモーダル */}
      {isOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsOpen(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>USJパークマップ</h2>
              <button
                className={styles.closeButton}
                onClick={() => setIsOpen(false)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <div className={styles.modalBody}>
              <img
                src="/map/usj-map.png"
                alt="USJパークマップ"
                className={styles.mapImage}
                onError={(e) => {
                  // 画像が読み込めない場合のフォールバック
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                  const parent = target.parentElement;
                  if (parent && !parent.querySelector('.mapPlaceholder')) {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'mapPlaceholder';
                    placeholder.style.cssText = `
                      width: 100%;
                      height: min(420px, 55dvh);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                      color: white;
                      font-size: 18px;
                      font-weight: 600;
                      border-radius: 12px;
                      flex-direction: column;
                      gap: 16px;
                    `;
                    placeholder.innerHTML = `
                      <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
                        <line x1="8" y1="2" x2="8" y2="18" />
                        <line x1="16" y1="6" x2="16" y2="22" />
                      </svg>
                      <div>USJパークマップ</div>
                      <div style="font-size: 14px; opacity: 0.8;">マップ画像を /public/map/usj-map.png に配置してください</div>
                    `;
                    parent.appendChild(placeholder);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
