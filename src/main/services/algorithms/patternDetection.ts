// Vendor-payment frequency patterns and category suggestion.

export interface VendorPattern {
  vendorId: string;
  avgAmount: number;
  dayOfMonthPattern: number[];
  intervalDays: number;
}

export function detectVendorPattern(history: Array<{ vendorId: string; amount: number; date: string }>): VendorPattern[] {
  const byVendor: Record<string, Array<{ amount: number; date: string }>> = {};
  for (const r of history) {
    if (!byVendor[r.vendorId]) byVendor[r.vendorId] = [];
    byVendor[r.vendorId].push({ amount: r.amount, date: r.date });
  }
  return Object.entries(byVendor).map(([vid, txns]) => {
    const avgAmount = txns.reduce((s, t) => s + t.amount, 0) / txns.length;
    const dayPattern = new Array(32).fill(0);
    for (const t of txns) dayPattern[new Date(t.date).getDate()]++;
    txns.sort((a, b) => a.date.localeCompare(b.date));
    let intervalSum = 0;
    for (let i = 1; i < txns.length; i++) {
      intervalSum += (new Date(txns[i].date).getTime() - new Date(txns[i - 1].date).getTime()) / 86_400_000;
    }
    const intervalDays = txns.length > 1 ? intervalSum / (txns.length - 1) : 0;
    return { vendorId: vid, avgAmount, dayOfMonthPattern: dayPattern, intervalDays };
  });
}

export function suggestCategoryForVendor(vendorId: string, history: Array<{ vendorId: string; categoryId: string }>): string | null {
  const counts: Record<string, number> = {};
  for (const r of history) {
    if (r.vendorId === vendorId && r.categoryId) {
      counts[r.categoryId] = (counts[r.categoryId] || 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}
