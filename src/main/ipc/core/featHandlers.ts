import type { IpcMain } from 'electron';
import { defineHandler } from './defineHandler';
import type { HandlerCtx, IpcDeps } from './types';

// Convention: exactly one IPC payload (undefined when the renderer sends none); ctx is always last.
export interface FeatSpec<S> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (s: S, payload: any, ctx: HandlerCtx) => unknown;
  mutates?: boolean;
  requiresCompany?: unknown;
}

export function featHandlers<S>(ipc: Pick<IpcMain, 'handle'>, deps: IpcDeps, service: () => S, table: Record<string, FeatSpec<S>>): void {
  let s: S;
  let loaded = false;
  for (const [channel, spec] of Object.entries(table)) {
    const { call, ...rest } = spec;
    defineHandler(ipc, deps, channel, {
      ...rest,
      call: (ctx, ...args: unknown[]) => {
        if (!loaded) { s = service(); loaded = true; }
        return call(s, args[0], ctx);
      },
    });
  }
}
