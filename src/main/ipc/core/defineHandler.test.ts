import { describe, it, expect, vi } from 'vitest';
import { ipcMain } from 'electron';
import { defineHandler } from './defineHandler';
import { createTestDb } from '../../test/createTestDb';
import * as db from '../../database';

const deps = () => ({ scheduleAutoBackup: vi.fn() }) as any;

describe('defineHandler', () => {
  it('returns the call result and passes undefined through', async () => {
    createTestDb();
    defineHandler(ipcMain, deps(), 'x:read', { call: () => 42 });
    defineHandler(ipcMain, deps(), 'x:void', { call: () => undefined });
    expect(await (ipcMain as any).invoke('x:read')).toBe(42);
    expect(await (ipcMain as any).invoke('x:void')).toBeUndefined();
  });
  it('converts thrown errors to { error } and does not back up', async () => {
    createTestDb();
    const d = deps();
    defineHandler(ipcMain, d, 'x:boom', {
      call: () => {
        throw new Error('nope');
      },
      mutates: true,
    });
    expect(await (ipcMain as any).invoke('x:boom')).toEqual({ error: 'nope' });
    expect(d.scheduleAutoBackup).not.toHaveBeenCalled();
  });
  it('converts async rejections to { error } and does not back up', async () => {
    createTestDb();
    const d = deps();
    defineHandler(ipcMain, d, 'x:rej', {
      call: () => Promise.reject(new Error('later')),
      mutates: true,
    });
    expect(await (ipcMain as any).invoke('x:rej')).toEqual({ error: 'later' });
    expect(d.scheduleAutoBackup).not.toHaveBeenCalled();
  });
  it('does not back up when a handler returns an { error } object', async () => {
    createTestDb();
    const d = deps();
    defineHandler(ipcMain, d, 'x:rete', { call: () => ({ error: 'x' }), mutates: true });
    expect(await (ipcMain as any).invoke('x:rete')).toEqual({ error: 'x' });
    expect(d.scheduleAutoBackup).not.toHaveBeenCalled();
  });
  it('still backs up when a result has no error key', async () => {
    createTestDb();
    const d = deps();
    defineHandler(ipcMain, d, 'x:retf', { call: () => ({ ok: false }), mutates: true });
    await (ipcMain as any).invoke('x:retf');
    expect(d.scheduleAutoBackup).toHaveBeenCalledTimes(1);
  });
  it('schedules exactly one backup after a successful mutate', async () => {
    createTestDb();
    const d = deps();
    defineHandler(ipcMain, d, 'x:mut', { call: () => ({ ok: true }), mutates: true });
    await (ipcMain as any).invoke('x:mut');
    expect(d.scheduleAutoBackup).toHaveBeenCalledTimes(1);
  });
  it('short-circuits with the configured empty value when no company is active', async () => {
    createTestDb();
    db.switchCompany(null as any);
    defineHandler(ipcMain, deps(), 'x:list', {
      call: () => ['should not run'],
      requiresCompany: [],
    });
    defineHandler(ipcMain, deps(), 'x:one', { call: () => 'x', requiresCompany: null });
    defineHandler(ipcMain, deps(), 'x:err', {
      call: () => 'x',
      requiresCompany: { error: 'No active company' },
    });
    expect(await (ipcMain as any).invoke('x:list')).toEqual([]);
    expect(await (ipcMain as any).invoke('x:one')).toBeNull();
    expect(await (ipcMain as any).invoke('x:err')).toEqual({ error: 'No active company' });
  });
  it('passes cid, db and args to call', async () => {
    const t = createTestDb();
    defineHandler(ipcMain, deps(), 'x:ctx', {
      call: (ctx, a: number, b: number) => ({ cid: ctx.cid, sum: a + b, hasDb: !!ctx.db }),
    });
    expect(await (ipcMain as any).invoke('x:ctx', 2, 3)).toEqual({
      cid: t.companyId,
      sum: 5,
      hasDb: true,
    });
  });
});
