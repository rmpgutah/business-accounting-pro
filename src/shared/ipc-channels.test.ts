import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { CHANNELS } from './ipc-channels';

const set = new Set<string>(CHANNELS);
const root = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.resolve(root, p), 'utf8');

describe('ipc-channels', () => {
  it('is up to date with the handler sources', () => {
    expect(() =>
      execFileSync('npx', ['tsx', 'scripts/gen-ipc-channels.ts', '--check'], {
        cwd: root,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 120_000);
  it('covers every channel api.ts invokes', () => {
    const missing = [...read('src/renderer/lib/api.ts').matchAll(/invoke\(\s*'([^']+)'/g)]
      .map((m) => m[1])
      .filter((c) => !set.has(c));
    expect(missing).toEqual([]);
  });
  it('covers every channel the Cloudflare worker handles', () => {
    const missing = [...read('cloudflare-app/src/api-rpc.ts').matchAll(/case\s+'([^']+)'/g)]
      .map((m) => m[1])
      .filter((c) => !set.has(c));
    expect(missing).toEqual([]);
  });
});
