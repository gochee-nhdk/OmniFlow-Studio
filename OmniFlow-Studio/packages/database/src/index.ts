// FM AUTO OPS — Database Layer
// Uses Node.js native built-in SQLite engine (node:sqlite DatabaseSync)
// Zero native compilation dependencies, robust local persistence.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { LogRedactor } from '@fm/security';
import { SCHEMA_SQL } from './schema';

type WorkflowStatus = string;
type StepStatus = string;
type DownloadStatus = string;
type ErrorType = string;
type ErrorSeverity = string;
type RecoveryAction = string;

export interface WorkflowRunRow {
  id: string;
  workflowType: string;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  errorSummary?: string;
}

export interface WorkflowStepRow {
  id: string;
  runId: string;
  stepName: string;
  stepIndex: number;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  errorMessage?: string;
}

export interface DownloadRow {
  id: string;
  runId?: string;
  reportType: string;
  fileName: string;
  filePath: string;
  fileSizeBytes?: number;
  rowCount?: number;
  status: DownloadStatus;
  downloadedAt: string;
  validatedAt?: string;
  checksum?: string;
}

export interface ErrorLogRow {
  id: string;
  runId?: string;
  stepId?: string;
  errorType: ErrorType;
  severity: ErrorSeverity;
  message: string;
  technicalDetails?: string;
  recoveryAction?: RecoveryAction;
  recovered: boolean;
  createdAt: string;
}

export class FMDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Execute a WAL checkpoint to flush all pending WAL frames into the main database file.
   */
  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  }

  /**
   * Creates a point-in-time snapshot backup of fmauto.sqlite after flushing WAL.
   * Rotates older snapshots so at most maxRetained files are kept in the directory.
   */
  createBackup(backupDir?: string, maxRetained = 10): { backupPath: string; timestamp: string; sizeBytes: number } {
    if (this.dbPath === ':memory:') {
      throw new Error('Cannot create file backup of an in-memory database (:memory:)');
    }

    const targetDir = backupDir || (process.env.APP_DATA_DIR
      ? join(process.env.APP_DATA_DIR, 'backups', 'snapshots')
      : join(dirname(this.dbPath), 'backups', 'snapshots'));

    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    // 1. Flush WAL to ensure consistent snapshot on disk
    this.checkpoint();

    // 2. Generate timestamp and snapshot destination
    const timestamp = new Date().toISOString();
    const fileStamp = timestamp.replace(/[:.]/g, '-');
    const backupPath = join(targetDir, `fmauto-snapshot-${fileStamp}.sqlite`);

    // 3. Cleanly copy the flushed database file
    copyFileSync(this.dbPath, backupPath);
    const sizeBytes = statSync(backupPath).size;

    // 4. Automatic rotation: retain at most maxRetained snapshots
    if (maxRetained > 0) {
      try {
        const existing = readdirSync(targetDir)
          .filter((name) => name.startsWith('fmauto-snapshot-') && name.endsWith('.sqlite'))
          .map((name) => {
            const fullPath = join(targetDir, name);
            const stats = statSync(fullPath);
            return { name, fullPath, mtimeMs: stats.mtimeMs };
          })
          .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

        if (existing.length > maxRetained) {
          const toRemove = existing.slice(0, existing.length - maxRetained);
          for (const item of toRemove) {
            try {
              unlinkSync(item.fullPath);
            } catch {}
          }
        }
      } catch {}
    }

    return { backupPath, timestamp, sizeBytes };
  }

  /**
   * Lists all existing SQLite snapshot backups ordered newest first.
   */
  listSnapshots(backupDir?: string): Array<{ fileName: string; filePath: string; timestamp: string; sizeBytes: number }> {
    const targetDir = backupDir || (process.env.APP_DATA_DIR
      ? join(process.env.APP_DATA_DIR, 'backups', 'snapshots')
      : join(dirname(this.dbPath), 'backups', 'snapshots'));

    if (!existsSync(targetDir)) return [];

    try {
      const files = readdirSync(targetDir)
        .filter((name) => name.startsWith('fmauto-snapshot-') && name.endsWith('.sqlite'))
        .map((name) => {
          const fullPath = join(targetDir, name);
          const stats = statSync(fullPath);
          return {
            fileName: name,
            filePath: fullPath,
            timestamp: stats.mtime.toISOString(),
            sizeBytes: stats.size,
            mtimeMs: stats.mtimeMs,
          };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

      return files.map(({ fileName, filePath, timestamp, sizeBytes }) => ({
        fileName,
        filePath,
        timestamp,
        sizeBytes,
      }));
    } catch {
      return [];
    }
  }

  // ---- Settings ----
  getSetting(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `)
      .run(key, value);
  }

  getAllSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ---- Workflow Runs ----
  createWorkflowRun(workflowType: string): WorkflowRunRow {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO workflow_runs (id, workflow_type, status, started_at)
        VALUES (?, ?, 'RUNNING', ?)
      `)
      .run(id, workflowType, now);
    return { id, workflowType, status: 'RUNNING', startedAt: now, retryCount: 0 };
  }

  updateWorkflowRunStatus(id: string, status: WorkflowStatus, errorSummary?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE workflow_runs
        SET status = ?,
            completed_at = ?,
            duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER),
            error_summary = ?
        WHERE id = ?
      `)
      .run(status, now, now, errorSummary ?? null, id);
  }

  getWorkflowRun(id: string): WorkflowRunRow | null {
    const row = this.db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapWorkflowRun(row);
  }

  listWorkflowRuns(limit = 50, offset = 0): WorkflowRunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as Record<string, unknown>[];
    return rows.map(this.mapWorkflowRun);
  }

  private mapWorkflowRun(row: Record<string, unknown>): WorkflowRunRow {
    return {
      id: String(row['id']),
      workflowType: String(row['workflow_type']),
      status: String(row['status']),
      startedAt: String(row['started_at']),
      completedAt: row['completed_at'] ? String(row['completed_at']) : undefined,
      durationMs: row['duration_ms'] != null ? Number(row['duration_ms']) : undefined,
      retryCount: Number(row['retry_count'] || 0),
      errorSummary: row['error_summary'] ? String(row['error_summary']) : undefined,
    };
  }

  // ---- Workflow Steps ----
  createWorkflowStep(runId: string, stepName: string, stepIndex: number): WorkflowStepRow {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO workflow_steps (id, run_id, step_name, step_index, status, started_at)
        VALUES (?, ?, ?, ?, 'RUNNING', ?)
      `)
      .run(id, runId, stepName, stepIndex, now);
    return { id, runId, stepName, stepIndex, status: 'RUNNING', startedAt: now, retryCount: 0 };
  }

  updateWorkflowStep(id: string, status: StepStatus, errorMessage?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE workflow_steps
        SET status = ?,
            completed_at = ?,
            duration_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER),
            error_message = ?
        WHERE id = ?
      `)
      .run(status, now, now, errorMessage ?? null, id);
  }

  getWorkflowSteps(runId: string): WorkflowStepRow[] {
    const rows = this.db
      .prepare('SELECT * FROM workflow_steps WHERE run_id = ? ORDER BY step_index')
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      runId: String(r['run_id']),
      stepName: String(r['step_name']),
      stepIndex: Number(r['step_index']),
      status: String(r['status']),
      startedAt: r['started_at'] ? String(r['started_at']) : undefined,
      completedAt: r['completed_at'] ? String(r['completed_at']) : undefined,
      durationMs: r['duration_ms'] != null ? Number(r['duration_ms']) : undefined,
      retryCount: Number(r['retry_count'] || 0),
      errorMessage: r['error_message'] ? String(r['error_message']) : undefined,
    }));
  }

  // ---- Download History ----
  recordDownload(data: Omit<DownloadRow, 'id'>): DownloadRow {
    const id = uuidv4();
    this.db
      .prepare(`
        INSERT INTO download_history
          (id, run_id, report_type, file_name, file_path, file_size_bytes, row_count, status, downloaded_at, checksum)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        data.runId ?? null,
        data.reportType,
        data.fileName,
        data.filePath,
        data.fileSizeBytes ?? null,
        data.rowCount ?? null,
        data.status,
        data.downloadedAt,
        data.checksum ?? null
      );
    return { ...data, id };
  }

  getRecentDownloads(reportType?: string, limit = 10): DownloadRow[] {
    const sql = reportType
      ? 'SELECT * FROM download_history WHERE report_type = ? ORDER BY downloaded_at DESC LIMIT ?'
      : 'SELECT * FROM download_history ORDER BY downloaded_at DESC LIMIT ?';
    const args = reportType ? [reportType, limit] : [limit];
    const rows = this.db.prepare(sql).all(...args) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      runId: r['run_id'] ? String(r['run_id']) : undefined,
      reportType: String(r['report_type']),
      fileName: String(r['file_name']),
      filePath: String(r['file_path']),
      fileSizeBytes: r['file_size_bytes'] != null ? Number(r['file_size_bytes']) : undefined,
      rowCount: r['row_count'] != null ? Number(r['row_count']) : undefined,
      status: String(r['status']),
      downloadedAt: String(r['downloaded_at']),
      validatedAt: r['validated_at'] ? String(r['validated_at']) : undefined,
      checksum: r['checksum'] ? String(r['checksum']) : undefined,
    }));
  }

  // ---- Error Logs ----
  logError(data: {
    runId?: string;
    stepId?: string;
    errorType: ErrorType;
    severity: ErrorSeverity;
    message: string;
    technicalDetails?: string;
    recoveryAction?: RecoveryAction;
  }): void {
    const sanitizedMsg = String(LogRedactor.redact(data.message));
    const sanitizedDetails = data.technicalDetails ? String(LogRedactor.redact(data.technicalDetails)) : null;
    this.db
      .prepare(`
        INSERT INTO error_logs
          (id, run_id, step_id, error_type, severity, message, technical_details, recovery_action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        uuidv4(),
        data.runId ?? null,
        data.stepId ?? null,
        data.errorType,
        data.severity,
        sanitizedMsg,
        sanitizedDetails,
        data.recoveryAction ?? null
      );
  }

  listErrors(limit = 100, severity?: ErrorSeverity): ErrorLogRow[] {
    const sql = severity
      ? 'SELECT * FROM error_logs WHERE severity = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?';
    const args = severity ? [severity, limit] : [limit];
    const rows = this.db.prepare(sql).all(...args) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      runId: r['run_id'] ? String(r['run_id']) : undefined,
      stepId: r['step_id'] ? String(r['step_id']) : undefined,
      errorType: String(r['error_type']),
      severity: String(r['severity']),
      message: String(r['message']),
      technicalDetails: r['technical_details'] ? String(r['technical_details']) : undefined,
      recoveryAction: r['recovery_action'] ? String(r['recovery_action']) : undefined,
      recovered: Boolean(r['recovered']),
      createdAt: String(r['created_at']),
    }));
  }

  clearErrors(): void {
    this.db.prepare('DELETE FROM error_logs').run();
  }

  // ---- Credentials Metadata ----
  upsertCredentialMeta(data: {
    id: string;
    accountName: string;
    application: string;
    username: string;
    credentialKey: string;
    url: string;
  }): void {
    this.db
      .prepare(`
        INSERT INTO credentials_metadata
          (id, account_name, application, username, credential_key, url, auth_state)
        VALUES (?, ?, ?, ?, ?, ?, 'NOT_CONFIGURED')
        ON CONFLICT(account_name) DO UPDATE SET
          username = excluded.username,
          url = excluded.url,
          updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      `)
      .run(data.id, data.accountName, data.application, data.username, data.credentialKey, data.url);
  }

  listCredentialMeta(): Array<{
    id: string;
    accountName: string;
    account_name: string;
    application: string;
    username: string;
    url: string;
    isEnabled: boolean;
    is_enabled: number;
    lastVerifiedAt?: string;
    last_verified_at?: string;
    authState: string;
    auth_state: string;
    createdAt: string;
    created_at: string;
  }> {
    const rows = this.db
      .prepare('SELECT id, account_name, application, username, url, is_enabled, last_verified_at, auth_state, created_at FROM credentials_metadata')
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id'] || ''),
      accountName: String(r['account_name'] || ''),
      account_name: String(r['account_name'] || ''),
      application: String(r['application'] || ''),
      username: String(r['username'] || ''),
      url: String(r['url'] || ''),
      isEnabled: Boolean(r['is_enabled']),
      is_enabled: Number(r['is_enabled'] || 0),
      lastVerifiedAt: r['last_verified_at'] ? String(r['last_verified_at']) : undefined,
      last_verified_at: r['last_verified_at'] ? String(r['last_verified_at']) : undefined,
      authState: String(r['auth_state'] || 'NOT_CONFIGURED'),
      auth_state: String(r['auth_state'] || 'NOT_CONFIGURED'),
      createdAt: String(r['created_at'] || ''),
      created_at: String(r['created_at'] || ''),
    }));
  }

  audit(action: string, target?: string, details?: Record<string, unknown>): void {
    let sanitizedDetails: string | null = null;
    if (details) {
      sanitizedDetails = String(LogRedactor.redact(details));
    }
    const sanitizedTarget = target ? String(LogRedactor.redact(target)) : null;
    const sanitizedAction = action ? String(LogRedactor.redact(action)) : action;

    this.db
      .prepare(`
        INSERT INTO audit_logs (id, action, target, details)
        VALUES (?, ?, ?, ?)
      `)
      .run(uuidv4(), sanitizedAction, sanitizedTarget, sanitizedDetails);
  }

  close(): void {
    this.db.close();
  }
}
