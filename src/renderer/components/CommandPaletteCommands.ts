// Back-compat shim — the command catalog now lives in src/shared/action-registry.ts.
import { NAV_ACTIONS, findActions } from '../../shared/action-registry';
export const RENDERER_COMMANDS = NAV_ACTIONS;
export const findCommands = findActions;
export type RendererCommand = typeof NAV_ACTIONS[number];
