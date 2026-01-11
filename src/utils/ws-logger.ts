/**
 * Lightweight logger for WebSocket and performance-critical code
 * Supports log level filtering to reduce console I/O overhead
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

// Priority: error=4, warn=3, info=2, debug=1, none=0
const LOG_PRIORITY: Record<LogLevel, number> = {
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
  none: 0
};

let currentLevel: LogLevel = getInfo();

// Get log level from env or default to 'info'
function getInfo(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase();
  if (envLevel && LOG_PRIORITY[envLevel as LogLevel] !== undefined) {
    return envLevel as LogLevel;
  }
  return 'info'; // default level
}

/**
 * Set the log level
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get current log level
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Check if a log level should be printed
 */
function shouldPrint(level: LogLevel): boolean {
  return LOG_PRIORITY[level] <= LOG_PRIORITY[currentLevel];
}

/**
 * Lightweight logger with level filtering
 */
export const wsLog = {
  debug: (message: string, ...args: any[]): void => {
    if (shouldPrint('debug')) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]): void => {
    if (shouldPrint('info')) {
      console.log(`[WS-INFO] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]): void => {
    if (shouldPrint('warn')) {
      console.warn(`[WS-WARN] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]): void => {
    if (shouldPrint('error')) {
      console.error(`[WS-ERROR] ${message}`, ...args);
    }
  }
};

export default wsLog;
