import { describe, it, expect, vi } from 'vitest';
import { ipcMain } from 'electron';
import { featHandlers } from './featHandlers';
import { createTestDb } from '../../test/createTestDb';

describe('featHandlers', () => {
  it('registers every key, loads the service lazily, and applies mutates/requiresCompany', async () => {
    const t = createTestDb();
    const loads = vi.fn(() => ({ list: (cid: string, c?: string) => [cid, c], apply: (id: string) => ({ ok: id }) }));
    const deps = { scheduleAutoBackup: vi.fn() } as any;
    featHandlers(ipcMain as any, deps, loads, {
      'feat:t:list': { call: (s, { client_id }: any = {}, ctx) => s.list(ctx.cid!, client_id), requiresCompany: [] },
      'feat:t:apply': { call: (s, { id }: any) => s.apply(id), mutates: true },
    });
    expect(loads).not.toHaveBeenCalled();
    expect((ipcMain as any).channels()).toEqual(['feat:t:list', 'feat:t:apply']);
    expect(await (ipcMain as any).invoke('feat:t:list', { client_id: 'c1' })).toEqual([t.companyId, 'c1']);
    expect(await (ipcMain as any).invoke('feat:t:apply', { id: 'i1' })).toEqual({ ok: 'i1' });
    expect(loads).toHaveBeenCalledTimes(1);
    expect(deps.scheduleAutoBackup).toHaveBeenCalledTimes(1);
  });
});
