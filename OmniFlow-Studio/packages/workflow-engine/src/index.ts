// FM AUTO OPS — Workflow Orchestration Engine
// Implements the "RUN DAILY PROCUREMENT" state machine with recovery, partial success, and validation.

import { POSAdapter, POSCredentials } from '@fm/pos-adapter';
import { SAPAdapter, SAPLoginOptions } from '@fm/sap-adapter';
import { ExcelValidator, DownloadFileManager } from '@fm/file-engine';
import { FMDatabase } from '@fm/database';
import { BrowserManager } from '@fm/browser-engine';
import path from 'path';

export function getDefaultReportsDir(reportSubDir?: string): string {
  const baseDir = process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_DATA_DIR || process.env.OMNIFLOW_PORTABLE_DATA || process.env.APP_DATA_DIR || process.cwd();
  return reportSubDir ? path.join(baseDir, 'reports', reportSubDir) : path.join(baseDir, 'reports');
}

export type StepCallback = (stepName: string, status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED', error?: string) => void;

export interface WorkflowOptions {
  browserManager: BrowserManager;
  db: FMDatabase;
  posUrl?: string;
  sapUrl?: string;
  posCredentials?: POSCredentials;
  sapCredentials?: SAPLoginOptions;
  onStepChange?: StepCallback;
  fromDate?: string;
  toDate?: string;
  dateRangeRule?: 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS' | 'THIS_MONTH' | string;
  storeFilter?: string;
  slocFilter?: string;
  itemFilter?: string;
  salesOutputDir?: string;
  salesFileNameTemplate?: string;
  inventoryOutputDir?: string;
  inventoryFileNameTemplate?: string;
  sapOutputDir?: string;
  orgCode?: string;
  sapAutoTakeOverSession?: boolean;
  sapTargetModule?: 'HOME' | 'PURCHASING_PO' | 'PURCHASING_GRPO' | 'PURCHASING_RETURN' | 'INVENTORY_STATUS';
  signal?: AbortSignal;
}

export class DailyProcurementRunner {
  private browserManager: BrowserManager;
  private db: FMDatabase;
  private onStepChange?: StepCallback;
  private options: WorkflowOptions;

  constructor(options: WorkflowOptions) {
    this.browserManager = options.browserManager;
    this.db = options.db;
    this.onStepChange = options.onStepChange;
    this.options = options;
  }

  async run(overrideOptions?: Partial<WorkflowOptions>): Promise<{ success: boolean; runId: string; status: string; errors: string[] }> {
    const opts = { ...this.options, ...overrideOptions };
    const run = this.db.createWorkflowRun('DAILY_PROCUREMENT');
    const errors: string[] = [];
    let hasInventorySuccess = false;
    let hasSalesSuccess = false;
    let hasSapSuccess = false;

    try {
      if (opts.signal?.aborted) throw new Error('Workflow execution cancelled by user');

      // STEP 1: Preflight
      this.notify('Preflight Check & Storage Verification', 'RUNNING');
      const step1 = this.db.createWorkflowStep(run.id, 'Preflight Verification', 1);
      this.db.updateWorkflowStep(step1.id, 'SUCCESS');
      this.notify('Preflight Check & Storage Verification', 'SUCCESS');

      // STEP 2: POS Sales Transaction Detail Automation
      if (opts.signal?.aborted) throw new Error('Workflow execution cancelled by user');
      this.notify('POS: Sales Transaction Detail Automation', 'RUNNING');
      const step2 = this.db.createWorkflowStep(run.id, 'Download Sales Report', 2);
      try {
        const pos = new POSAdapter(this.browserManager, opts.posUrl);
        let fromDate = opts.fromDate;
        let toDate = opts.toDate;
        if (!fromDate || !toDate) {
          const rule = opts.dateRangeRule || 'TODAY';
          const calculated = POSAdapter.calculateDateRange(rule);
          fromDate = fromDate || calculated.from;
          toDate = toDate || calculated.to;
        }

        const salesOutputDir = opts.salesOutputDir || getDefaultReportsDir('Sales');
        const salesResult = await pos.downloadSalesTransactionDetail({
          fromDate,
          toDate,
          storeFilter: opts.storeFilter || 'All',
          outputDir: salesOutputDir,
          fileNameTemplate: opts.salesFileNameTemplate || 'Sales_{{fromDate}}_{{toDate}}.xlsx',
          orgCode: opts.orgCode,
        }, opts.posCredentials);

        // Validate
        const validator = new ExcelValidator();
        const validation = await validator.validateWorkbook(salesResult.tempFilePath);

        // Organize
        const fileManager = new DownloadFileManager();
        const finalPath = fileManager.moveAndRename(
          salesResult.tempFilePath,
          salesOutputDir,
          salesResult.suggestedFilename
        );

        this.db.recordDownload({
          runId: run.id,
          reportType: 'SALES',
          fileName: salesResult.suggestedFilename,
          filePath: finalPath,
          rowCount: validation.rowCount ?? 0,
          status: validation.valid ? 'SUCCESS_WITH_DATA' : 'INVALID',
          downloadedAt: new Date().toISOString(),
        });

        if (validation.valid) {
          hasSalesSuccess = true;
          this.db.updateWorkflowStep(step2.id, 'SUCCESS');
          this.notify('POS: Sales Transaction Detail Automation', 'SUCCESS');
        } else {
          const err = `Sales workbook validation failed: ${validation.errors.join('; ')}`;
          errors.push(err);
          this.db.updateWorkflowStep(step2.id, 'FAILED', err);
          this.db.logError({
            runId: run.id,
            stepId: step2.id,
            errorType: 'FILE_INVALID',
            severity: 'ERROR',
            message: err,
            recoveryAction: 'RETRY',
          });
          this.notify('POS: Sales Transaction Detail Automation', 'FAILED', err);
        }
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`Sales download failed: ${msg}`);
        this.db.updateWorkflowStep(step2.id, 'FAILED', msg);
        this.db.logError({
          runId: run.id,
          stepId: step2.id,
          errorType: 'DOWNLOAD_FAILED',
          severity: 'ERROR',
          message: msg,
          recoveryAction: 'RETRY',
        });
        this.notify('POS: Sales Transaction Detail Automation', 'FAILED', msg);
      }

      // STEP 3: POS Inventory Onhand Automation
      if (opts.signal?.aborted) throw new Error('Workflow execution cancelled by user');
      this.notify('POS: Inventory Onhand Automation', 'RUNNING');
      const step3 = this.db.createWorkflowStep(run.id, 'Download Inventory Report', 3);
      try {
        const pos = new POSAdapter(this.browserManager, opts.posUrl);
        const inventoryOutputDir = opts.inventoryOutputDir || getDefaultReportsDir('Inventory');
        const invResult = await pos.downloadInventoryOnhand({
          storeFilter: opts.storeFilter || 'All',
          slocFilter: opts.slocFilter,
          itemFilter: opts.itemFilter,
          outputDir: inventoryOutputDir,
          fileNameTemplate: opts.inventoryFileNameTemplate || 'Inventory_Onhand_{{timestamp}}.xlsx',
          orgCode: opts.orgCode,
        }, opts.posCredentials);

        const validator = new ExcelValidator();
        const validation = await validator.validateWorkbook(invResult.tempFilePath);
        const fileManager = new DownloadFileManager();
        const finalPath = fileManager.moveAndRename(
          invResult.tempFilePath,
          inventoryOutputDir,
          invResult.suggestedFilename
        );

        this.db.recordDownload({
          runId: run.id,
          reportType: 'INVENTORY',
          fileName: invResult.suggestedFilename,
          filePath: finalPath,
          rowCount: validation.rowCount ?? 0,
          status: validation.valid ? 'SUCCESS_WITH_DATA' : 'INVALID',
          downloadedAt: new Date().toISOString(),
        });

        if (validation.valid) {
          hasInventorySuccess = true;
          this.db.updateWorkflowStep(step3.id, 'SUCCESS');
          this.notify('POS: Inventory Onhand Automation', 'SUCCESS');
        } else {
          const err = `Inventory workbook validation failed: ${validation.errors.join('; ')}`;
          errors.push(err);
          this.db.updateWorkflowStep(step3.id, 'FAILED', err);
          this.db.logError({
            runId: run.id,
            stepId: step3.id,
            errorType: 'FILE_INVALID',
            severity: 'ERROR',
            message: err,
            recoveryAction: 'RETRY',
          });
          this.notify('POS: Inventory Onhand Automation', 'FAILED', err);
        }
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`Inventory report skipped: ${msg}`);
        this.db.updateWorkflowStep(step3.id, 'FAILED', msg);
        this.db.logError({
          runId: run.id,
          stepId: step3.id,
          errorType: 'DOWNLOAD_FAILED',
          severity: 'ERROR',
          message: msg,
          recoveryAction: 'SKIP',
        });
        this.notify('POS: Inventory Onhand Automation', 'FAILED', msg);
      }

      // STEP 4: SAP Session & Health Verification
      if (opts.signal?.aborted) throw new Error('Workflow execution cancelled by user');
      this.notify('SAP: Session & Health Verification', 'RUNNING');
      const step4 = this.db.createWorkflowStep(run.id, 'Verify SAP Session', 4);
      try {
        const sap = new SAPAdapter(this.browserManager, opts.sapUrl);
        const sapSession = await sap.checkSession();
        if (sapSession.authState === 'DISCONNECTED') {
          throw new Error(sapSession.errorMessage || 'SAP server is disconnected or unreachable');
        }
        if (sapSession.authState === 'LOGIN_REQUIRED') {
          if (!opts.sapCredentials) {
            throw new Error('SAP login is required, but no SAP credentials configured');
          }
          const loginOpts: SAPLoginOptions = {
            ...opts.sapCredentials,
            autoTakeOverSession: opts.sapAutoTakeOverSession ?? opts.sapCredentials.autoTakeOverSession,
            targetModule: opts.sapTargetModule || opts.sapCredentials.targetModule || 'HOME',
            outputDir: opts.sapOutputDir || opts.sapCredentials.outputDir,
          };
          const loginRes = await sap.login(loginOpts, (msg) => {
            this.notify(`SAP: ${msg}`, 'RUNNING');
          });
          if (!loginRes.success) {
            throw new Error(loginRes.message || 'SAP authentication failed');
          }
        } else if (opts.sapTargetModule && opts.sapTargetModule !== 'HOME') {
          const page = await this.browserManager.getPage('SAP');
          await sap.navigateToTargetModule(page, opts.sapTargetModule, (msg) => {
            this.notify(`SAP: ${msg}`, 'RUNNING');
          });
        }
        hasSapSuccess = true;
        this.db.updateWorkflowStep(step4.id, 'SUCCESS');
        this.notify('SAP: Session & Health Verification', 'SUCCESS');
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`SAP verification failed: ${msg}`);
        this.db.updateWorkflowStep(step4.id, 'FAILED', msg);
        this.db.logError({
          runId: run.id,
          stepId: step4.id,
          errorType: 'AUTH_ERROR',
          severity: 'ERROR',
          message: msg,
          recoveryAction: 'RELOGIN',
        });
        this.notify('SAP: Session & Health Verification', 'FAILED', msg);
      }

      // Final status determination
      const allPassed = hasSalesSuccess && hasInventorySuccess && hasSapSuccess;
      const anyPassed = hasSalesSuccess || hasInventorySuccess || hasSapSuccess;
      const overallStatus = allPassed
        ? 'SUCCESS'
        : anyPassed
        ? 'PARTIAL_SUCCESS'
        : 'FAILED';

      this.db.updateWorkflowRunStatus(run.id, overallStatus, errors.length > 0 ? errors.join('\n') : undefined);
      return { success: overallStatus !== 'FAILED', runId: run.id, status: overallStatus, errors };
    } catch (criticalErr) {
      const msg = (criticalErr as Error).message;
      this.db.logError({
        runId: run.id,
        errorType: 'UNKNOWN',
        severity: 'CRITICAL',
        message: `Critical workflow runner failure: ${msg}`,
        recoveryAction: 'STOP',
      });
      this.db.updateWorkflowRunStatus(run.id, 'FAILED', msg);
      return { success: false, runId: run.id, status: 'FAILED', errors: [msg] };
    }
  }

  private notify(name: string, status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED', error?: string): void {
    if (this.onStepChange) {
      this.onStepChange(name, status, error);
    }
  }
}
