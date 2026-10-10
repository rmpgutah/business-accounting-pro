import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Domain files live one directory deeper than ipc/index.ts, so any
// '../services/…' reference moved verbatim would resolve to a nonexistent path.
describe('domain files', () => {
  it('reference services via ../../services, never ../services', () => {
    const dir = __dirname;
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/['"]\.\.\/(services|database|rules|sync|integrations)\b/.test(line))
          offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
