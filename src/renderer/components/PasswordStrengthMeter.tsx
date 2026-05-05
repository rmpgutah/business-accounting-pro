// src/renderer/components/PasswordStrengthMeter.tsx
//
// P5.59 — Password strength meter
//
// Inline strength indicator for password fields (registration,
// change-password). Computes a 0–4 score using a quick heuristic
// (length + character classes + common-pattern penalties) so it's
// runtime-cheap and doesn't require zxcvbn (~400KB).
//
// Score → label:
//   0    Very weak  (red)
//   1    Weak       (red)
//   2    Fair       (orange)
//   3    Strong     (green)
//   4    Excellent  (green)
//
// Drop into any password form:
//
//   <input type="password" value={pw} onChange={...} />
//   <PasswordStrengthMeter password={pw} />

import React from 'react';

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty', 'abc123',
  '111111', '123456', '1234567', '12345678', '123456789',
  'letmein', 'welcome', 'admin', 'admin123', 'iloveyou',
  'changeme', 'monkey', 'dragon', 'master', 'login',
]);

interface ScoreResult {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  warnings: string[];
  suggestions: string[];
}

export function scorePassword(pw: string): ScoreResult {
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!pw) {
    return { score: 0, label: '', warnings: [], suggestions: [] };
  }

  // Length is the dominant factor.
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (pw.length < 8) suggestions.push('Use at least 8 characters');

  // Character-class diversity.
  const classes = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^a-zA-Z0-9]/.test(pw),
  ].filter(Boolean).length;
  if (classes >= 3) score += 1;
  else suggestions.push('Mix uppercase, lowercase, numbers, and symbols');

  // Common-password penalty.
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    warnings.push('This is one of the most-guessed passwords');
    score = 0;
  }

  // Repetition penalty (e.g. "aaaaaaa" or "abcabc")
  if (/(.)\1{3,}/.test(pw)) {
    warnings.push('Avoid repeating characters');
    score = Math.max(0, score - 1);
  }
  if (/^(.+?)\1+$/.test(pw)) {
    warnings.push('Avoid repeating sequences');
    score = Math.max(0, score - 1);
  }

  // Sequential-character penalty (e.g. "abcdef", "12345")
  if (/(?:abcdef|qwerty|123456)/i.test(pw)) {
    warnings.push('Avoid common sequences (qwerty, 12345, abcdef)');
    score = Math.max(0, score - 1);
  }

  const finalScore = Math.min(4, Math.max(0, score)) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent'];
  return { score: finalScore, label: labels[finalScore], warnings, suggestions };
}

export const PasswordStrengthMeter: React.FC<{ password: string }> = ({ password }) => {
  const result = scorePassword(password);
  if (!password) return null;

  const palette = ['#dc2626', '#dc2626', '#d97706', '#16a34a', '#16a34a'];
  const fillPct = ((result.score + 1) / 5) * 100;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          style={{
            flex: 1,
            height: 4,
            background: 'var(--color-bg-secondary)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: fillPct + '%',
              height: '100%',
              background: palette[result.score],
              transition: 'width 200ms ease, background 200ms ease',
            }}
          />
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, color: palette[result.score], minWidth: 60, textAlign: 'right' }}>
          {result.label}
        </span>
      </div>
      {(result.warnings.length > 0 || result.suggestions.length > 0) && (
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4, lineHeight: 1.4 }}>
          {result.warnings.map((w, i) => (
            <div key={'w' + i} style={{ color: '#dc2626' }}>⚠ {w}</div>
          ))}
          {result.suggestions.map((s, i) => (
            <div key={'s' + i}>· {s}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PasswordStrengthMeter;
