import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerWorkflowsAutomationIpc } from './workflows-automation';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('workflows-automation domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerWorkflowsAutomationIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('automations:list returns an array', async () => {
    const res = await ipc.invoke('automations:list');
    expect(Array.isArray(res)).toBe(true);
  });

  it('automations:create persists a rule and schedules a backup', async () => {
    const res = await ipc.invoke('automations:create', {
      name: 'Nightly',
      trigger_type: 'schedule',
      trigger_config: '{}',
      conditions: '[]',
      actions: '[]',
    });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM automation_rules WHERE company_id = ?')
      .all(companyId);
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });

  it('macro:list returns an array', async () => {
    const res = await ipc.invoke('macro:list', { user_id: 'u1' });
    expect(Array.isArray(res)).toBe(true);
  });

  it('macro:save inserts a macro and schedules a backup', async () => {
    const res = await ipc.invoke('macro:save', {
      user_id: 'u1',
      name: 'Close month',
      action_sequence: [],
    });
    expect(res.success).toBe(true);
    const rows = db.getDb().prepare('SELECT id FROM macros WHERE company_id = ?').all(companyId);
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
