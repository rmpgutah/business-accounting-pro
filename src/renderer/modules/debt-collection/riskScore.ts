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
