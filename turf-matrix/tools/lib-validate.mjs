/**
 * lib-validate.mjs — week-data.json スキーマ検証(共有モジュール)
 *
 * update-data.mjs(注入時) と csv-to-week.mjs(生成時) の両方から使用。
 * 検証基準を1箇所に集約し、ツール間のズレを防ぐ。
 * スキーマ: schemaVersion 2 (β v0.3)
 */

export const FACTOR_KEYS = [
  "ability", "distance", "lap", "training", "trainingLap", "stable", "frame", "course", "pace",
];
export const PEDIGREE_KEYS = [
  "course", "distance", "going", "lap", "family", "speed", "stamina", "burst", "sustain",
];

/**
 * @returns {{ errors: string[], warnings: string[] }}
 */
export const validateWeekData = (data) => {
  const errors = [];
  const warnings = [];

  if (!data?.meta?.date) errors.push("meta.date がありません");
  if (!data?.meta?.dateLabel) warnings.push("meta.dateLabel がありません(ヘッダー表示が空になります)");
  if (!Array.isArray(data?.races) || data.races.length === 0) {
    if (data?.meta?.dataStatus !== "missing") errors.push("races is empty");
  }

  const seenIds = new Set();
  for (const r of data?.races ?? []) {
    for (const k of ["id", "track", "number", "name", "time", "surface", "distance", "going", "fieldSize"])
      if (r[k] == null) errors.push(`${r.id ?? "?"}: レースの ${k} が欠落`);
    if ((r.horses?.length ?? 0) !== r.fieldSize)
      errors.push(`${r.id}: fieldSize(${r.fieldSize}) と horses数(${r.horses?.length ?? 0}) が不一致`);

    for (const h of r.horses ?? []) {
      if (seenIds.has(h.id)) errors.push(`${h.id}: idが重複しています`);
      seenIds.add(h.id);
      for (const k of ["id", "number", "name", "jockey", "popularity", "odds", "aiScore", "comment"])
        if (h[k] == null) errors.push(`${h.id ?? r.id + "-?"}: 馬の ${k} が欠落`);

      const a = h.analysis;
      if (!a) { errors.push(`${h.id}: analysis が欠落`); continue; }

      for (const k of FACTOR_KEYS) {
        const v = a.factors?.[k];
        if (v == null) errors.push(`${h.id}: factors.${k} が欠落`);
        else if (v < 0 || v > 100) errors.push(`${h.id}: factors.${k}=${v} が範囲外(0-100)`);
      }
      if (!Array.isArray(a.insight) || a.insight.length < 3) warnings.push(`${h.id}: insight が3行未満`);
      if (!Array.isArray(a.confidenceReasons) || a.confidenceReasons.length < 2)
        errors.push(`${h.id}: confidenceReasons が2件未満(信頼度には理由が必須)`);
      if (!Array.isArray(a.pros) || !a.pros.length) warnings.push(`${h.id}: pros が空`);
      if (!Array.isArray(a.cons) || !a.cons.length) warnings.push(`${h.id}: cons が空`);
      if (!a.commentary) errors.push(`${h.id}: commentary が欠落`);
      if (!a.frameEval?.text || a.frameEval?.score == null) errors.push(`${h.id}: frameEval が不完全`);
      if (!a.trainingEval?.oneWeek?.text) errors.push(`${h.id}: trainingEval.oneWeek が欠落(一週前が主要評価です)`);
      if (!["high", "mid", "low"].includes(a.confidence)) errors.push(`${h.id}: confidence は high/mid/low`);
      if (!a.pedigree?.lines || a.pedigree.lines.length !== 4)
        errors.push(`${h.id}: pedigree.lines は4ライン(父系/母父系/母母父系/牝系)必須`);
      for (const k of PEDIGREE_KEYS)
        if (a.pedigree?.scores?.[k] == null) errors.push(`${h.id}: pedigree.scores.${k} が欠落`);
    }
  }

  for (const f of data?.featured ?? []) {
    const race = (data?.races ?? []).find((r) => r.id === f.raceId);
    if (!race) errors.push(`featured: raceId ${f.raceId} が存在しません`);
    else if (!race.horses.some((h) => h.id === f.horseId))
      errors.push(`featured: horseId ${f.horseId} が ${f.raceId} に存在しません`);
  }

  return { errors, warnings };
};
