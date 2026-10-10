import { describe, it, expect, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerAuthCompanyIpc } from './auth-company';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('auth-company domain', () => {
  beforeEach(() => {
    ipc.reset();
    createTestDb();
    registerAuthCompanyIpc(ipcMain, createIpcDeps());
  });

  it('auth:has-users is true with the harness user', async () => {
    expect(await ipc.invoke('auth:has-users')).toBe(true);
  });

  it('company:list returns the harness company', async () => {
    const res = await ipc.invoke('company:list');
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
  });
});
