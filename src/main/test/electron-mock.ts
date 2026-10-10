import os from 'os';
import path from 'path';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
// The mock can be instantiated twice (Vite-resolved import and native require via the
// tsx hook), so ipcMain lives on globalThis to keep one registry and one identity.
const g = globalThis as { __bapIpcMain?: typeof ipcMainImpl };
const handlers = new Map<string, Handler>();

const ipcMainImpl = {
  handle(channel: string, fn: Handler) {
    if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    handlers.set(channel, fn);
  },
  removeHandler(channel: string) { handlers.delete(channel); },
  on() {}, once() {}, removeAllListeners() {},
  async invoke(channel: string, ...args: unknown[]) {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`No handler registered for '${channel}'`);
    return fn({ sender: { send() {} } }, ...args);
  },
  channels(): string[] { return [...handlers.keys()]; },
  reset() { handlers.clear(); },
};
export const ipcMain = (g.__bapIpcMain ??= ipcMainImpl);

export const app = {
  getPath: (_name: string) => path.join(os.tmpdir(), 'bap-test-userdata'),
  getVersion: () => '0.0.0-test',
  getName: () => 'Business Accounting Pro',
  isPackaged: false,
  on() {}, whenReady: () => Promise.resolve(), quit() {},
};

export class BrowserWindow {
  static getAllWindows() { return []; }
  static getFocusedWindow() { return null; }
  webContents = { send() {} };
}
export const dialog = { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
export const shell = { openPath: async () => '', showItemInFolder() {}, openExternal: async () => {} };
export const contextBridge = { exposeInMainWorld() {} };
export const ipcRenderer = { invoke: async () => undefined, on() {}, removeListener() {} };
export const Notification = class { show() {} };
export const nativeImage = { createFromPath: () => ({}) };
export default { ipcMain, app, BrowserWindow, dialog, shell };
