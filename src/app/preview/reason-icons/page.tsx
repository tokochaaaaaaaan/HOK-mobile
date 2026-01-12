"use client";

import React from "react";

// 統一プレビュー用のアイコン定義（既存の資産パスを利用・ラベルは指定どおりフル日本語）
const reasonIcons = [
  { key: "gourmet",    src: "/emoji/gourmet.svg",    emoji: "🍽️", text: "食事",     fullText: "食事" },
  { key: "thrill",     src: "/emoji/thrill.svg",     emoji: "🎢",  text: "スリル",   fullText: "スリル" },
  { key: "experience", src: "/emoji/experience.svg", emoji: "🎯",  text: "体験",     fullText: "体験" },
  { key: "shopping",   src: "/emoji/shopping.svg",   emoji: "🛍️", text: "買い物",   fullText: "買い物" },
  { key: "design",     src: "/emoji/design.svg",     emoji: "🏛️", text: "デザイン", fullText: "デザイン" },
  { key: "scenery",    src: "/emoji/scenery.svg",    emoji: "🌅",  text: "景色",     fullText: "景色" },
  { key: "time",       src: "/emoji/time.svg",       emoji: "⏰",  text: "時間",     fullText: "時間" },
  { key: "cost",       src: "/emoji/cost.svg",       emoji: "💰",  text: "コスト",   fullText: "コスト" },
  { key: "friends",    src: "/emoji/friends.svg",    emoji: "👥",  text: "友人",     fullText: "友人" },
  { key: "family",     src: "/emoji/family.svg",     emoji: "👨‍👩‍👧‍👦", text: "家族", fullText: "家族" },
  { key: "relax",      src: "/emoji/relax.svg",      emoji: "🧘",  text: "リラックス", fullText: "リラックス" },
  { key: "other",      src: "/emoji/other.svg",      emoji: "❗",  text: "他",       fullText: "他" },
];

export default function ReasonIconsPreviewPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "28px 16px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: "#0f172a" }}>理由アイコン・ラベル案（プレビュー）</h1>
        <div style={{ marginTop: 8, color: "#475569" }}>アイコンの真下に短い日本語ラベル（1語）を表示する案です。</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 12,
            marginTop: 16,
          }}
        >
          {reasonIcons.map((icon) => (
            <div
              key={icon.key}
              title={`${icon.fullText}`}
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <img src={icon.src} alt={icon.fullText} style={{ width: 48, height: 48 }} />
              <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", letterSpacing: 0.5 }}>{icon.text}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, fontSize: 12, color: "#64748b" }}>
          ラベルはフル日本語（例: 食事/スリル/体験/買い物/デザイン/景色/時間/コスト/友人/家族/リラックス/他）です。ホバーで同義の補足をツールチップ表示します。
        </div>
      </div>
    </div>
  );
}
