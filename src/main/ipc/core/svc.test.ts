import { describe, it, expect } from 'vitest';
import { svc } from './svc';

describe('svc', () => {
  it('lazy-loads and caches the service module', () => {
    const resolved = require.resolve('../../services/loan-calculator');
    expect(require.cache[resolved]).toBeUndefined();
    const get = svc<{ generateSchedule: unknown }>('loan-calculator');
    expect(require.cache[resolved]).toBeUndefined();
    const mod = get();
    expect(require.cache[resolved]).toBeDefined();
    expect(typeof mod.generateSchedule).toBe('function');
    expect(get()).toBe(mod);
  });
});
