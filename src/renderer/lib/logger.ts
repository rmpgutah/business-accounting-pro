const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#6b7280',
  info: '#3b82f6',
  warn: '#f59e0b',
  error: '#ef4444',
};

let currentLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'warn';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatArgs(args: unknown[]): string {
  return args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a ?? '∅')).join(' ');
}

function log(level: LogLevel, module: string, args: unknown[]): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;
  const timestamp = new Date().toISOString().substring(11, 23);
  const prefix = `%c[${timestamp}] %c[${level.toUpperCase()}]%c ${module}:`;
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    prefix,
    `color: ${LEVEL_COLORS[level]}`,
    `color: ${LEVEL_COLORS[level]}; font-weight: bold`,
    'color: inherit',
    ...args,
  );
}

export const logger = {
  debug: (module: string, ...args: unknown[]) => log('debug', module, args),
  info: (module: string, ...args: unknown[]) => log('info', module, args),
  warn: (module: string, ...args: unknown[]) => log('warn', module, args),
  error: (module: string, ...args: unknown[]) => log('error', module, args),
};
