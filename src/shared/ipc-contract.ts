import type { Channel } from './ipc-channels';

/** Opt-in per-channel typing. Channels not listed accept any args and return any. */
export interface IpcContract {
  'auth:has-users': { args: []; result: boolean };
}

export type ArgsOf<C extends Channel> = C extends keyof IpcContract
  ? IpcContract[C]['args']
  : any[];
export type ResultOf<C extends Channel> = C extends keyof IpcContract
  ? IpcContract[C]['result']
  : any;
