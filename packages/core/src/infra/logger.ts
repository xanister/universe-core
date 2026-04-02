import { appendFile, mkdir, rename, unlink, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DATA_ROOT } from '@dmnpc/data';

const LOG_DIR = join(DATA_ROOT, '..', '..', 'logs');
const CURRENT_LOG = join(LOG_DIR, 'server.log');
const PREV_LOG = join(LOG_DIR, 'server-prev.log');

function isTestEnv(): boolean {
  // Vitest sets one (or more) of these in Node test runs.
  // We keep this intentionally redundant to avoid relying on a single variable.
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.VITEST_WORKER_ID !== undefined ||
    process.env.JEST_WORKER_ID !== undefined
  );
}

/**
 * Get current log file path
 */
function getLogFilePath(): string {
  return CURRENT_LOG;
}

/**
 * Ensure log directory exists
 */
async function ensureLogDir(): Promise<void> {
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true });
  }
}

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
};

/**
 * Format log message with timestamp (string only)
 */
function formatLogMessage(level: string, prefix: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] [${prefix}] ${message}\n`;
}

/**
 * Format highlighted log message with green color for terminal
 */
function formatHighlightLogMessage(prefix: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${COLORS.brightGreen}[${timestamp}] [HIGHLIGHT] [${prefix}] ${message}${COLORS.reset}\n`;
}

/**
 * Format highlighted log message for file (no color codes)
 */
function formatHighlightLogMessageForFile(prefix: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [HIGHLIGHT] [${prefix}] ${message}\n`;
}

/**
 * Format error log message with timestamp (supports object args for debugging)
 */
function formatErrorLogMessage(
  level: string,
  prefix: string,
  message: string,
  ...args: unknown[]
): string {
  const timestamp = new Date().toISOString();
  const argsStr =
    args.length > 0
      ? ' ' +
        args
          .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
            return JSON.stringify(arg);
          })
          .join(' ')
      : '';
  return `[${timestamp}] [${level}] [${prefix}] ${message}${argsStr}\n`;
}

/**
 * Write log to file (string only)
 */
async function writeLog(level: string, prefix: string, message: string): Promise<void> {
  if (isTestEnv()) return;
  try {
    await ensureLogDir();
    const logPath = getLogFilePath();
    const logLine = formatLogMessage(level, prefix, message);
    await appendFile(logPath, logLine, 'utf-8');
  } catch (error) {
    // Silently fail if logging fails - don't break the app
    if (!isTestEnv()) {
      console.error('[Logger] Failed to write log:', error);
    }
  }
}

/**
 * Write error log to file (supports object args)
 */
async function writeErrorLog(
  level: string,
  prefix: string,
  message: string,
  ...args: unknown[]
): Promise<void> {
  if (isTestEnv()) return;
  try {
    await ensureLogDir();
    const logPath = getLogFilePath();
    const logLine = formatErrorLogMessage(level, prefix, message, ...args);
    await appendFile(logPath, logLine, 'utf-8');
  } catch (error) {
    // Silently fail if logging fails - don't break the app
    if (!isTestEnv()) {
      console.error('[Logger] Failed to write log:', error);
    }
  }
}

/**
 * Write highlight log to file (no color codes in file)
 */
async function writeHighlightLog(prefix: string, message: string): Promise<void> {
  if (isTestEnv()) return;
  try {
    await ensureLogDir();
    const logPath = getLogFilePath();
    const logLine = formatHighlightLogMessageForFile(prefix, message);
    await appendFile(logPath, logLine, 'utf-8');
  } catch (error) {
    // Silently fail if logging fails - don't break the app
    if (!isTestEnv()) {
      console.error('[Logger] Failed to write log:', error);
    }
  }
}

/**
 * Clean up old log files (keep only server.log and server-prev.log)
 */
async function cleanupOldLogs(): Promise<void> {
  if (isTestEnv()) return;
  try {
    await ensureLogDir();
    const files = await readdir(LOG_DIR);
    for (const file of files) {
      if (file !== 'server.log' && file !== 'server-prev.log' && file.endsWith('.log')) {
        const filePath = join(LOG_DIR, file);
        await unlink(filePath);
      }
    }
  } catch (error) {
    // Silently fail - don't break the app
    if (!isTestEnv()) {
      console.error('[Logger] Failed to cleanup old logs:', error);
    }
  }
}

/**
 * Rotate log files: move server.log to server-prev.log
 * This should be called on server start/stop
 */
async function rotateLogs(): Promise<void> {
  if (isTestEnv()) return;
  try {
    await ensureLogDir();

    if (existsSync(CURRENT_LOG)) {
      if (existsSync(PREV_LOG)) {
        await unlink(PREV_LOG);
      }
      await rename(CURRENT_LOG, PREV_LOG);
    }

    await cleanupOldLogs();
  } catch (error) {
    // Silently fail - don't break the app
    if (!isTestEnv()) {
      console.error('[Logger] Failed to rotate logs:', error);
    }
  }
}

/**
 * Logger utility that writes to both console and file
 */
export const logger = {
  /**
   * Log info message (string only - no object logging)
   */
  info(prefix: string, message: string): void {
    if (isTestEnv()) return;
    const formatted = formatLogMessage('INFO', prefix, message);
    process.stdout.write(formatted);
    void writeLog('INFO', prefix, message);
  },

  /**
   * Log highlighted message in green (for player/assistant messages)
   * Stands out visually in terminal but is separate from errors
   */
  highlight(prefix: string, message: string): void {
    if (isTestEnv()) return;
    const formatted = formatHighlightLogMessage(prefix, message);
    process.stdout.write(formatted);
    void writeHighlightLog(prefix, message);
  },

  /**
   * Log warning message (string only - no object logging)
   */
  warn(prefix: string, message: string): void {
    if (isTestEnv()) return;
    const formatted = formatLogMessage('WARN', prefix, message);
    process.stderr.write(formatted);
    void writeLog('WARN', prefix, message);
  },

  /**
   * Log error message (supports object args for debugging)
   */
  error(prefix: string, message: string, ...args: unknown[]): void {
    if (isTestEnv()) return;
    const formatted = formatErrorLogMessage('ERROR', prefix, message, ...args);
    process.stderr.write(formatted);
    void writeErrorLog('ERROR', prefix, message, ...args);
  },

  /**
   * Log debug message (string only - no object logging)
   */
  debug(prefix: string, message: string): void {
    if (isTestEnv()) return;
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      const formatted = formatLogMessage('DEBUG', prefix, message);
      process.stdout.write(formatted);
    }
    void writeLog('DEBUG', prefix, message);
  },

  /**
   * Get current log file path
   */
  getLogFilePath(): string {
    return getLogFilePath();
  },

  /**
   * Rotate log files (call on server start/stop)
   */
  rotate(): Promise<void> {
    return rotateLogs();
  },
};
