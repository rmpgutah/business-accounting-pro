import type { IpcMain } from 'electron';
import { defineHandler } from './defineHandler';
import type { IpcDeps } from './types';

// Convention: the IPC args come first and the HandlerCtx is ALWAYS the last argument.
// (A `[...A, HandlerCtx]` tuple does not type-check for variadic `any[]` handlers, so it is typed loosely.)
export interface FeatSpec<S> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (s: S, ...args: any[]) => unknown;
  mutates?: boolean;
  requiresCompany?: unknown;
}

export function featHandlers<S>(ipc: Pick<IpcMain, 'handle'>, deps: IpcDeps, service: () => S, table: Record<string, FeatSpec<S>>): void {
  let s: S | undefined;
  for (const [channel, spec] of Object.entries(table)) {
    const { call, ...rest } = spec;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defineHandler(ipc, deps, channel, { ...rest, call: (ctx, ...args: unknown[]) => call((s ??= service()), ...(args as any[]), ctx) });
  }
}
