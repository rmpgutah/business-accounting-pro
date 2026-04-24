export function calcRiskScore(debt: any, brokenPromisesCount = 0): number {
  let score = 0;

  // Days delinquent
  const delinquentDate = debt.delinquent_date || debt.due_date;
  const days = delinquentDate
    ? Math.max(0, Math.floor((Date.now() - new Date(delinquentDate).getTime()) / 86400000))
    : 0;
  if (days <= 30) score += 10;
  else if (days <= 90) score += 20;
  else if (days <= 180) score += 30;
  else score += 40;

  // Balance tier
  const bal = debt.balance_due || 0;
  if (bal < 500) score += 5;
  else if (bal < 2000) score += 10;
  else if (bal < 10000) score += 20;
  else score += 30;

  // Stage
  const STAGE_SCORES: Record<string, number> = {
    reminder: 5, warning: 10, final_notice: 15, demand_letter: 20,
    collections_agency: 25, legal_action: 30, judgment: 35, garnishment: 35,
  };
  score += STAGE_SCORES[debt.current_stage] || 5;

  // Broken promises
  score += Math.min(brokenPromisesCount * 5, 20);

  return Math.min(score, 100);
}

export function getRiskBadge(score: number): { label: string; color: string } {
  if (score <= 30) return { label: 'Low', color: '#22c55e' };
  if (score <= 55) return { label: 'Medium', color: '#d97706' };
  if (score <= 80) return { label: 'High', color: '#f97316' };
  return { label: 'Critical', color: '#ef4444' };
}

// ─── Feature 3: Collection Score Algorithm ──────────────────
// Returns 0–100 based on multiple weighted factors.
// Higher = more likely to collect successfully.
export function collectionScore(debt: any, opts: {
  brokenPromises?: number;
  hasLegalAction?: boolean;
  hasPaymentPlan?: boolean;
  hasEmployment?: boolean;
  contactAttempts?: number;
} = {}): number {
  let score = 50; // baseline

  // Balance amount (high balance = harder to collect, lower score)
  const bal = debt.balance_due || 0;
  if (bal < 500) score += 15;
  else if (bal < 2000) score += 10;
  else if (bal < 5000) score += 5;
  else if (bal < 10000) score -= 5;
  else score -= 10;

  // Days delinquent (longer = harder)
  const delinquentDate = debt.delinquent_date || debt.due_date;
  const days = delinquentDate
    ? Math.max(0, Math.floor((Date.now() - new Date(delinquentDate).getTime()) / 86400000))
    : 0;
  if (days <= 30) score += 15;
  else if (days <= 90) score += 5;
  else if (days <= 180) score -= 5;
  else score -= 15;

  // Broken promises (negative signal)
  const broken = opts.brokenPromises || 0;
  score -= Math.min(broken * 5, 20);

  // Has legal action (positive — enforcing)
  if (opts.hasLegalAction) score += 10;

  // Has active payment plan (positive — engagement)
  if (opts.hasPaymentPlan) score += 10;

  // Has employment info (positive — garnishment possible)
  if (opts.hasEmployment) score += 10;

  // Contact attempts (more = diminishing returns)
  const contacts = opts.contactAttempts || 0;
  if (contacts >= 1 && contacts <= 5) score += 5;
  else if (contacts > 10) score -= 5;

  return Math.max(0, Math.min(100, score));
}

export function getCollectionBadge(score: number): { label: string; color: string } {
  if (score >= 75) return { label: 'Excellent', color: '#22c55e' };
  if (score >= 50) return { label: 'Good', color: '#3b82f6' };
  if (score >= 30) return { label: 'Fair', color: '#d97706' };
  return { label: 'Poor', color: '#ef4444' };
}
