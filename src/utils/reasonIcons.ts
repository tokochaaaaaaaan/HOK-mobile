export type ReasonIcon = {
  key: string;
  emoji: string;
  fullText: string; // 正式ラベル（play2/waiting準拠）
  src?: string;     // public配下のアイコンパス（存在する場合）
  synonyms?: string[]; // 旧ラベルや短縮形（play3/resultの旧定義など）
};

export const reasonIcons: ReasonIcon[] = [
  { key: "gourmet",    emoji: "🍴", fullText: "ご当地グルメ", src: "/emoji/gourmet.svg", synonyms: ["食事", "食"] },
  { key: "photo",      emoji: "📷", fullText: "写真映え",     src: "/emoji/photo.svg",   synonyms: ["写"] },
  { key: "thrill",     emoji: "🎢", fullText: "スリル",       src: "/emoji/thrill.svg",  synonyms: ["激"] },
  { key: "experience", emoji: "🏃", fullText: "体験",         src: "/emoji/experience.svg", synonyms: ["体"] },
  { key: "shopping",   emoji: "🛍", fullText: "買い物",       src: "/emoji/shopping.svg", synonyms: ["買"] },
  { key: "design",     emoji: "🖼", fullText: "建築・デザイン", src: "/emoji/design.svg",   synonyms: ["建築"] },
  { key: "scenery",    emoji: "🏞", fullText: "景色",         src: "/emoji/scenery.svg",  synonyms: ["景"] },
  { key: "time",       emoji: "⏱", fullText: "時間",         src: "/emoji/time.svg",     synonyms: ["時"] },
  { key: "cost",       emoji: "💰", fullText: "コスパ",       src: "/emoji/cost.svg",     synonyms: ["¥"] },
  { key: "friends",    emoji: "🤝", fullText: "友達と一緒に", src: "/emoji/friends.svg",  synonyms: ["友"] },
  { key: "family",     emoji: "👪", fullText: "家族向け",     src: "/emoji/family.svg",   synonyms: ["家"] },
  { key: "relax",      emoji: "🧘", fullText: "リラックス",   src: "/emoji/relax.svg",    synonyms: ["休"] },
  { key: "other",      emoji: "❗", fullText: "その他",       src: "/emoji/other.svg",    synonyms: ["他"] },
];

export const findIconByLabel = (labelRaw: string | undefined): ReasonIcon | undefined => {
  const label = (labelRaw || "").trim();
  if (!label) return undefined;
  // 正式ラベル一致
  let icon = reasonIcons.find(i => i.fullText === label);
  if (icon) return icon;
  // 同義語一致
  icon = reasonIcons.find(i => (i.synonyms || []).includes(label));
  return icon;
};

// 理由文字列から非言語アイコンと自由記述テキストを抽出
// 例: "建築・デザイン:美術館の外観が好き" → emoji: 🖼, text: 美術館の外観が好き
//     "建築・デザイン" → emoji: 🖼, text: ""（ラベルは表示しない）
//     "写真映え:インスタに上げたい" → emoji: 📷, text: インスタに上げたい
//     "自由記述のみ" → emoji: undefined, text: 自由記述のみ
export const parseReason = (reasonRaw: string | undefined): { emoji?: string; text?: string } => {
  const result: { emoji?: string; text?: string } = {};
  const reason = (reasonRaw || "").trim();
  if (!reason) return result;

  const colonIndex = reason.indexOf(":");
  if (colonIndex !== -1) {
    const iconPart = reason.substring(0, colonIndex).trim();
    const customPart = reason.substring(colonIndex + 1).trim();
    const icon = findIconByLabel(iconPart);
    if (icon) result.emoji = icon.emoji;
    // ラベルは表示しない。自由記述のみ表示
    result.text = customPart || "";
    return result;
  }

  // コロン無し：ラベルだけ or 自由記述だけ
  const iconOnly = findIconByLabel(reason);
  if (iconOnly) {
    result.emoji = iconOnly.emoji;
    result.text = ""; // ラベル文字は表示しない
    return result;
  }

  // 既知ラベルでなければ自由記述としてそのまま表示
  result.text = reason;
  return result;
};
