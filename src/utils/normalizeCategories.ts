// カテゴリ配列の重複排除と整合性維持ユーティリティ
// veryWant/veryDont に含まれるカードは want/dont/neutral から除去し、
// want/dont に含まれるカードは neutral から除去します。
// また各配列内の重複も排除します。

export type BasicCard = { id: string; title?: string; src?: string; backSrc?: string; reason?: string };

export type RawCategories = {
  verywant?: BasicCard[]; // 旧保存形式の小文字
  want?: BasicCard[];
  neutral?: BasicCard[];
  dont?: BasicCard[];
  verydont?: BasicCard[];
  // 統一フォーマットのキャメルケース
  veryWant?: BasicCard[];
  veryDont?: BasicCard[];
};

export interface NormalizedCategories {
  veryWant: BasicCard[]; // 統一フォーマット（キャメルケース）
  want: BasicCard[];
  neutral: BasicCard[];
  dont: BasicCard[];
  veryDont: BasicCard[];
}

function uniqueById(list: BasicCard[] | undefined): BasicCard[] {
  if (!list) return [];
  const seen = new Set<string>();
  const result: BasicCard[] = [];
  for (const c of list) {
    if (!c || !c.id) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    result.push(c);
  }
  return result;
}

export function normalizeCategories(raw: RawCategories): NormalizedCategories {
  const verywant = raw.verywant || raw.veryWant || [];
  const verydont = raw.verydont || raw.veryDont || [];
  const want = raw.want || [];
  const dont = raw.dont || [];
  const neutral = raw.neutral || [];

  let vw = uniqueById(verywant);
  let vd = uniqueById(verydont);
  let w = uniqueById(want);
  let d = uniqueById(dont);
  let n = uniqueById(neutral);

  const vwIds = new Set(vw.map(c => c.id));
  const vdIds = new Set(vd.map(c => c.id));

  w = w.filter(c => !vwIds.has(c.id));
  d = d.filter(c => !vdIds.has(c.id));

  const occupied = new Set<string>([
    ...vwIds,
    ...vdIds,
    ...w.map(c => c.id),
    ...d.map(c => c.id),
  ]);
  n = n.filter(c => !occupied.has(c.id));

  return { veryWant: vw, want: w, neutral: n, dont: d, veryDont: vd };
}

export function normalizeFinalSelectionDoc(data: any): any {
  if (!data) return data;
  if (data.categories) {
    const normalized = normalizeCategories(data.categories);
    return {
      ...data,
      categories: normalized,
      // 実験データ用に旧形式も保存
      verywant: normalized.veryWant.map((c: BasicCard) => c.id),
      verydont: normalized.veryDont.map((c: BasicCard) => c.id),
      want: normalized.want.map((c: BasicCard) => c.id),
      dont: normalized.dont.map((c: BasicCard) => c.id),
      neutral: normalized.neutral.map((c: BasicCard) => c.id),
    };
  }
  const raw: RawCategories = {
    verywant: (data.verywant || []).map((id: string) => ({ id })),
    verydont: (data.verydont || []).map((id: string) => ({ id })),
    want: (data.want || []).map((id: string) => ({ id })),
    dont: (data.dont || []).map((id: string) => ({ id })),
    neutral: (data.neutral || []).map((id: string) => ({ id })),
  };
  const normalized = normalizeCategories(raw);
  return {
    ...data,
    categories: normalized,
  };
}
