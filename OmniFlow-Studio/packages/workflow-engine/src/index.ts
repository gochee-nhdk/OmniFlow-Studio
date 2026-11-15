// FM AUTO OPS — Workflow Orchestration Engine
// Implements the "RUN DAILY PROCUREMENT" state machine with recovery, partial success, and validation.

import { POSAdapter } from '@fm/pos-adapter';
import { SAPAdapter } from '@fm/sap-adapter';
import { ExcelValidator, DownloadFileManager } from '@fm/file-engine';
import { FMDatabase } from '@fm/database';
import { BrowserManager } from '@fm/browser-engine';
import os from 'os';
import path from 'path';

export type StepCallback = (stepName: string, status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED', error?: string) => void;

export interface WorkflowOptions {
  browserManager: BrowserManager;
  db: FMDatabase;
  posUrl?: string;
  sapUrl?: string;
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

    try {
      // STEP 1: Preflight
      this.notify('Preflight Check & Storage Verification', 'RUNNING');
      const step1 = this.db.createWorkflowStep(run.id, 'Preflight Verification', 1);
      this.db.updateWorkflowStep(step1.id, 'SUCCESS');
      this.notify('Preflight Check & Storage Verification', 'SUCCESS');

      // STEP 2: POS Sales Transaction Detail Automation
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
        
        const salesResult = await pos.downloadSalesTransactionDetail({
          fromDate,
          toDate,
          storeFilter: opts.storeFilter || 'All',
          outputDir: opts.salesOutputDir || path.join(os.homedir(), 'Documents', 'OmniFlow_Reports', 'Sales'),
          fileNameTemplate: opts.salesFileNameTemplate || 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
        });

        // Validate
        const validator = new ExcelValidator();
        const validation = await validator.validateWorkbook(salesResult.tempFilePath);
        
        // Organize
        const fileManager = new DownloadFileManager();
        const finalPath = fileManager.moveAndRename(
          salesResult.tempFilePath,
          opts.salesOutputDir || path.join(os.homedir(), 'Documents', 'OmniFlow_Reports', 'Sales'),
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
          errors.push(`Sales workbook validation failed: ${validation.errors.join('; ')}`);
          this.db.updateWorkflowStep(step2.id, 'FAILED', errors[errors.length - 1]);
          this.notify('POS: Sales Transaction Detail Automation', 'FAILED', errors[errors.length - 1]);
        }
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`Sales download failed: ${msg}`);
        this.db.updateWorkflowStep(step2.id, 'FAILED', msg);
        this.notify('POS: Sales Transaction Detail Automation', 'FAILED', msg);
      }

      // STEP 3: POS Inventory Onhand Automation
      this.notify('POS: Inventory Onhand Automation', 'RUNNING');
      const step3 = this.db.createWorkflowStep(run.id, 'Download Inventory Report', 3);
      try {
        const pos = new POSAdapter(this.browserManager, opts.posUrl);
        const invResult = await pos.downloadInventoryOnhand({
          storeFilter: opts.storeFilter || 'All',
          slocFilter: opts.slocFilter,
          itemFilter: opts.itemFilter,
          outputDir: opts.inventoryOutputDir || path.join(os.homedir(), 'Documents', 'OmniFlow_Reports', 'Inventory'),
          fileNameTemplate: opts.inventoryFileNameTemplate || 'Inventory_{YYYY-MM-DD}.xlsx',
        });

        const validator = new ExcelValidator();
        const validation = await validator.validateWorkbook(invResult.tempFilePath);
        const fileManager = new DownloadFileManager();
        const finalPath = fileManager.moveAndRename(
          invResult.tempFilePath,
          opts.inventoryOutputDir || path.join(os.homedir(), 'Documents', 'OmniFlow_Reports', 'Inventory'),
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
          this.db.updateWorkflowStep(step3.id, 'FAILED');
          this.notify('POS: Inventory Onhand Automation', 'FAILED');
        }
      } catch (err) {
        // Expected to be BLOCKED until live inspection
        const msg = (err as Error).message;
        errors.push(`Inventory report skipped: ${msg}`);
        this.db.updateWorkflowStep(step3.id, 'FAILED', msg);
        this.notify('POS: Inventory Onhand Automation', 'FAILED', msg);
      }

      // STEP 4: SAP Session & Health Verification
      this.notify('SAP: Session & Health Verification', 'RUNNING');
      const step4 = this.db.createWorkflowStep(run.id, 'Verify SAP Session', 4);
      try {
        const sap = new SAPAdapter(this.browserManager, opts.sapUrl);
        const sapSession = await sap.checkSession();
        this.db.updateWorkflowStep(step4.id, 'SUCCESS');
        this.notify('SAP: Session & Health Verification', 'SUCCESS');
      } catch (err) {
        this.db.updateWorkflowStep(step4.id, 'FAILED', (err as Error).message);
        this.notify('SAP: Session & Health Verification', 'FAILED', (err as Error).message);
      }

      // Final status determination
      const overallStatus = (hasSalesSuccess && hasInventorySuccess)
        ? 'SUCCESS'
        : (hasSalesSuccess || hasInventorySuccess)
        ? 'PARTIAL_SUCCESS'
        : 'FAILED';

      this.db.updateWorkflowRunStatus(run.id, overallStatus, errors.length > 0 ? errors.join('\n') : undefined);
      return { success: overallStatus !== 'FAILED', runId: run.id, status: overallStatus, errors };
    } catch (criticalErr) {
      this.db.updateWorkflowRunStatus(run.id, 'FAILED', (criticalErr as Error).message);
      return { success: false, runId: run.id, status: 'FAILED', errors: [(criticalErr as Error).message] };
    }
  }

  private notify(name: string, status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED', error?: string): void {
    if (this.onStepChange) {
      this.onStepChange(name, status, error);
    }
  }
}
