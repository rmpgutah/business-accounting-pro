import { describe, it, expect } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../test/createTestDb';
import { registerIpcHandlers } from './index';
import { CHANNELS } from '../../shared/ipc-channels';

describe('IPC registry', () => {
  it('registers exactly the generated channel set, with no duplicates', () => {
    createTestDb();
    registerIpcHandlers();
    const registered = (ipcMain as any).channels() as string[];
    expect(new Set(registered).size).toBe(registered.length);
    expect([...registered].sort()).toEqual([...CHANNELS]);
  });
});
