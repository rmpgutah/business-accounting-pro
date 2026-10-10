// @ts-ignore -- tsx/cjs has no type declarations; registers a .ts require hook for lazy require() in handlers
import 'tsx/cjs';
import { afterEach } from 'vitest';
import { ipcMain } from 'electron';

afterEach(() => { (ipcMain as any).reset?.(); });
