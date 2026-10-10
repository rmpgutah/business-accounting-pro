import type { Channel } from './ipc-channels';

export interface SaveResult {
  id?: string;
  error?: string;
}

/** Opt-in per-channel typing. Channels not listed accept any args and return any. */
export interface IpcContract {
  'auth:has-users': { args: []; result: boolean };
  'invoice:save': { args: any[]; result: SaveResult };
  'expense:save': { args: any[]; result: SaveResult };
}

export type ArgsOf<C extends Channel> = C extends keyof IpcContract
  ? IpcContract[C]['args']
  : any[];
export type ResultOf<C extends Channel> = C extends keyof IpcContract
  ? IpcContract[C]['result']
  : any;
