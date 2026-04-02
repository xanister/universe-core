import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { readFile, writeFile, mkdir, unlink, readdir, rm } from 'fs/promises';
import { existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Create an isolated temp directory so log files never touch the project.
const TEST_TMP = mkdtempSync(join(tmpdir(), 'logger-test-'));
const TEST_DATA_ROOT = join(TEST_TMP, 'packages', 'data');

vi.mock('@dmnpc/data', () => ({
  DATA_ROOT: TEST_DATA_ROOT,
}));

// Logger resolves LOG_DIR as DATA_ROOT/../../logs → TEST_TMP/logs
const { logger } = await import('@dmnpc/core/infra/logger.js');

const LOG_DIR = join(TEST_TMP, 'logs');
const CURRENT_LOG = join(LOG_DIR, 'server.log');
const PREV_LOG = join(LOG_DIR, 'server-prev.log');

// Store original environment
const originalVITEST = process.env.VITEST;
const originalVITEST_WORKER_ID = process.env.VITEST_WORKER_ID;
const originalNODE_ENV = process.env.NODE_ENV;

/**
 * Temporarily disable test environment detection to allow file operations
 */
function enableFileOperations() {
  delete process.env.VITEST;
  delete process.env.VITEST_WORKER_ID;
  process.env.NODE_ENV = 'development';
}

/**
 * Restore test environment detection
 */
function restoreTestEnv() {
  if (originalVITEST !== undefined) {
    process.env.VITEST = originalVITEST;
  } else {
    delete process.env.VITEST;
  }
  if (originalVITEST_WORKER_ID !== undefined) {
    process.env.VITEST_WORKER_ID = originalVITEST_WORKER_ID;
  } else {
    delete process.env.VITEST_WORKER_ID;
  }
  if (originalNODE_ENV !== undefined) {
    process.env.NODE_ENV = originalNODE_ENV;
  } else {
    delete process.env.NODE_ENV;
  }
}

describe('Logger', () => {
  beforeEach(async () => {
    // Clean the logs directory before each test (temp dir, no backup needed)
    await rm(LOG_DIR, { recursive: true, force: true });
    restoreTestEnv();
  });

  afterEach(() => {
    restoreTestEnv();
  });

  afterAll(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
  });

  describe('getLogFilePath', () => {
    it('returns the correct log file path', () => {
      const path = logger.getLogFilePath();
      expect(path).toContain('server.log');
      expect(path).toContain('logs');
      expect(path.toLowerCase()).toBe(CURRENT_LOG.toLowerCase());
    });
  });

  describe('rotation', () => {
    it('does nothing in test environment', async () => {
      // Ensure test environment is active
      restoreTestEnv();

      // Should not throw and should complete immediately
      await expect(logger.rotate()).resolves.toBeUndefined();

      // Verify no files were created
      expect(existsSync(CURRENT_LOG)).toBe(false);
      expect(existsSync(PREV_LOG)).toBe(false);
    });

    it('creates log directory if it does not exist', async () => {
      enableFileOperations();

      // Rotation should create the directory
      await logger.rotate();

      // Directory should exist after rotation
      expect(existsSync(LOG_DIR)).toBe(true);

      restoreTestEnv();
    });

    it('moves server.log to server-prev.log when rotating', async () => {
      enableFileOperations();

      // Ensure log directory exists
      await mkdir(LOG_DIR, { recursive: true });

      // Create server.log with test content
      const testContent = 'test log content line 1\ntest log content line 2\n';
      await writeFile(CURRENT_LOG, testContent, 'utf-8');

      expect(existsSync(CURRENT_LOG)).toBe(true);
      expect(existsSync(PREV_LOG)).toBe(false);

      // Rotate logs
      await logger.rotate();

      // After rotation: server.log should be gone, server-prev.log should exist with content
      expect(existsSync(CURRENT_LOG)).toBe(false);
      expect(existsSync(PREV_LOG)).toBe(true);

      const prevContent = await readFile(PREV_LOG, 'utf-8');
      expect(prevContent).toBe(testContent);

      restoreTestEnv();
    });

    it('removes old server-prev.log before rotating', async () => {
      enableFileOperations();

      // Ensure log directory exists
      await mkdir(LOG_DIR, { recursive: true });

      // Create both files
      await writeFile(PREV_LOG, 'old prev log\n', 'utf-8');
      await writeFile(CURRENT_LOG, 'current log\n', 'utf-8');

      // Rotate
      await logger.rotate();

      // Old server-prev.log should be gone, new one should have current log content
      expect(existsSync(CURRENT_LOG)).toBe(false);
      expect(existsSync(PREV_LOG)).toBe(true);

      const prevContent = await readFile(PREV_LOG, 'utf-8');
      expect(prevContent).toBe('current log\n');

      restoreTestEnv();
    });

    it('cleans up old log files during rotation', async () => {
      enableFileOperations();

      // Ensure log directory exists
      await mkdir(LOG_DIR, { recursive: true });

      // Create old log files
      const oldLog1 = join(LOG_DIR, 'server-2025-01-01.log');
      const oldLog2 = join(LOG_DIR, 'old.log');
      await writeFile(oldLog1, 'old log 1\n', 'utf-8');
      await writeFile(oldLog2, 'old log 2\n', 'utf-8');
      await writeFile(CURRENT_LOG, 'current log\n', 'utf-8');

      // Rotate
      await logger.rotate();

      // Old log files should be removed
      expect(existsSync(oldLog1)).toBe(false);
      expect(existsSync(oldLog2)).toBe(false);

      // Only server-prev.log should remain
      expect(existsSync(PREV_LOG)).toBe(true);
      expect(existsSync(CURRENT_LOG)).toBe(false);

      restoreTestEnv();
    });

    it('handles rotation when server.log does not exist', async () => {
      enableFileOperations();

      // Ensure log directory exists but no server.log
      await mkdir(LOG_DIR, { recursive: true });

      expect(existsSync(CURRENT_LOG)).toBe(false);

      // Rotation should complete without error
      await logger.rotate();

      // No files should be created
      expect(existsSync(CURRENT_LOG)).toBe(false);
      expect(existsSync(PREV_LOG)).toBe(false);

      restoreTestEnv();
    });
  });

  describe('logging methods', () => {
    it('does not write files in test environment', async () => {
      restoreTestEnv();

      // In test environment, logging should not create files
      logger.info('Test', 'message');
      logger.warn('Test', 'message');
      logger.error('Test', 'message');
      logger.debug('Test', 'message');
      logger.highlight('Test', 'message');

      // Verify no files were created
      expect(existsSync(CURRENT_LOG)).toBe(false);
    });

    it('writes logs to file when not in test environment', async () => {
      enableFileOperations();

      // Suppress stdout/stderr so logger output doesn't leak into test runner
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

      // Ensure log directory exists
      await mkdir(LOG_DIR, { recursive: true });

      // Log some messages
      logger.info('Test', 'info message');
      logger.warn('Test', 'warn message');
      logger.error('Test', 'error message');
      logger.highlight('Test', 'highlight message');

      // Wait a bit for async writes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // File should exist and contain log messages
      expect(existsSync(CURRENT_LOG)).toBe(true);
      const content = await readFile(CURRENT_LOG, 'utf-8');
      expect(content).toContain('info message');
      expect(content).toContain('warn message');
      expect(content).toContain('error message');
      expect(content).toContain('highlight message');
      expect(content).toContain('[INFO]');
      expect(content).toContain('[WARN]');
      expect(content).toContain('[ERROR]');
      expect(content).toContain('[HIGHLIGHT]');

      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      restoreTestEnv();
    });
  });

  describe('error handling', () => {
    it('handles rotation errors gracefully', async () => {
      enableFileOperations();

      // Rotation should not throw even if there are issues
      await expect(logger.rotate()).resolves.toBeUndefined();

      restoreTestEnv();
    });
  });
});
