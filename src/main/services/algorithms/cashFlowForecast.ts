// Linear regression + forecast with confidence intervals.

export interface ForecastResult {
  predicted: number;
  confidenceLow: number;
  confidenceHigh: number;
  slope: number;
  intercept: number;
}

export function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; stdError: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0, stdError: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const residuals = points.map(p => p.y - (slope * p.x + intercept));
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const stdError = Math.sqrt(ssRes / Math.max(1, n - 2));
  return { slope, intercept, stdError };
}

export function forecastValue(points: Array<{ x: number; y: number }>, futureX: number, confidence = 1.96): ForecastResult {
  const { slope, intercept, stdError } = linearRegression(points);
  const predicted = slope * futureX + intercept;
  const margin = confidence * stdError;
  return { predicted, confidenceLow: predicted - margin, confidenceHigh: predicted + margin, slope, intercept };
}
