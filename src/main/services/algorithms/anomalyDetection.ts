// Z-score based anomaly detection on a numeric series.

export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  mean: number;
  stdDev: number;
}

export function detectAnomaly(value: number, history: number[], threshold = 2): AnomalyResult {
  if (history.length < 5) return { isAnomaly: false, zScore: 0, mean: value, stdDev: 0 };
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
  const stdDev = Math.sqrt(variance);
  const zScore = stdDev > 0 ? (value - mean) / stdDev : 0;
  return { isAnomaly: Math.abs(zScore) > threshold, zScore, mean, stdDev };
}

export function detectDuplicates(records: Array<{ id: string; amount: number; date: string; entity: string }>): string[][] {
  const groups: Record<string, typeof records> = {};
  for (const r of records) {
    const key = `${r.amount.toFixed(2)}|${r.entity}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const dupes: string[][] = [];
  for (const grp of Object.values(groups)) {
    if (grp.length < 2) continue;
    grp.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < grp.length - 1; i++) {
      const dDays = Math.abs(
        (new Date(grp[i + 1].date).getTime() - new Date(grp[i].date).getTime()) / 86_400_000
      );
      if (dDays <= 3) dupes.push([grp[i].id, grp[i + 1].id]);
    }
  }
  return dupes;
}
