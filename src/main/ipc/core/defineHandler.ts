import type { IpcMain } from 'electron';
import * as db from '../../database';
import type { HandlerCtx, IpcDeps } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface HandlerSpec<A extends unknown[] = any[], R = unknown> {
  call: (ctx: HandlerCtx, ...args: A) => R | Promise<R>;
  mutates?: boolean;
  requiresCompany?: unknown;
}

export function defineHandler(ipc: Pick<IpcMain, 'handle'>, deps: IpcDeps, channel: string, spec: HandlerSpec): void {
  ipc.handle(channel, async (_event, ...args: unknown[]) => {
    const cid = db.getCurrentCompanyId();
    if ('requiresCompany' in spec && !cid) return spec.requiresCompany;
    try {
      const result = await spec.call({ cid, db: db.getDb(), deps }, ...args);
      if (spec.mutates) deps.scheduleAutoBackup();
      return result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  });
}
