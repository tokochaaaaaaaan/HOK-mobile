export type CardData = {
  id: number;
  title: string;
  frontSrc: string;  // 表面
  backSrc: string;   // 裏面
};

export const cards: CardData[] = Array.from({ length: 40 }, (_, i) => {
  const id = i + 1;
  return {
    id,
    title: `カード${id}`,
    frontSrc: `/pngs/USJ_${id}_surface-1.png`,      // ← ここ
    backSrc: `/pngs/back/USJ_${id}_back-1.png`,      // ← ここ
  };
});
