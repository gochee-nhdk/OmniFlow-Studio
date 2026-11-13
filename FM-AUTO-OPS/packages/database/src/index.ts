// FM AUTO OPS — Database Layer
// Uses Node.js native built-in SQLite engine (node:sqlite DatabaseSync)
// Zero native compilation dependencies, robust local persistence.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
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

  constructor(dbPath: string) {
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
        data.message,
        data.technicalDetails ?? null,
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

  listCredentialMeta(): Record<string, unknown>[] {
    return this.db
      .prepare('SELECT id, account_name, application, username, url, is_enabled, last_verified_at, auth_state, created_at FROM credentials_metadata')
      .all() as Record<string, unknown>[];
  }

  audit(action: string, target?: string, details?: Record<string, unknown>): void {
    this.db
      .prepare(`
        INSERT INTO audit_logs (id, action, target, details)
        VALUES (?, ?, ?, ?)
      `)
      .run(uuidv4(), action, target ?? null, details ? JSON.stringify(details) : null);
  }

  close(): void {
    this.db.close();
  }
}
