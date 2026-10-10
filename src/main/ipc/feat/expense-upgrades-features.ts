import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EXPENSE_UPGRADES_FEAT: Record<string, FeatSpec<any>> = {
  'feat:expense:bulk-recategorize': {
    call: (svc, { expense_ids, category_id }: any) =>
      svc.bulkRecategorize(expense_ids || [], category_id),
    mutates: true,
  },
};

export function registerExpenseUpgradesFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('expense-upgrades-features'), EXPENSE_UPGRADES_FEAT);
}
