import { afterEach } from 'vitest';
import { ipcMain } from 'electron';

afterEach(() => { (ipcMain as any).reset?.(); });
