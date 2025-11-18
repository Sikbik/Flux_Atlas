/* eslint-disable no-console */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const envLevel = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as LogLevel;
const currentLevel = levelOrder[envLevel] ?? levelOrder.info;

const log = (
  level: LogLevel,
  message: string,
  payload?: Record<string, unknown>
) => {
  if (levelOrder[level] < currentLevel) {
    return;
  }

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (payload) {
    console.log(prefix, message, payload);
  } else {
    console.log(prefix, message);
  }
};

export const logger = {
  debug: (message: string, payload?: Record<string, unknown>) =>
    log('debug', message, payload),
  info: (message: string, payload?: Record<string, unknown>) =>
    log('info', message, payload),
  warn: (message: string, payload?: Record<string, unknown>) =>
    log('warn', message, payload),
  error: (message: string, payload?: Record<string, unknown>) =>
    log('error', message, payload)
};
