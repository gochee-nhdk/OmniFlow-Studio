// FM AUTO OPS — File & Excel Engine
// Handles workbook validation, smart file naming, collision resolution, and folder routing.

import ExcelJS from 'exceljs';
import { existsSync, statSync, mkdirSync, copyFileSync, unlinkSync, renameSync } from 'fs';
import { join, basename, dirname, extname } from 'path';

export interface ExcelValidationResult {
  valid: boolean;
  errors: string[];
  rowCount: number | null;
  headers: string[] | null;
  worksheetCount: number;
}

export class ExcelValidator {
  /**
   * Validate Excel workbook integrity.
   * Checks:
   * 1. File exists
   * 2. Size exceeds minimum (1KB)
   * 3. Extension is .xlsx or .xls
   * 4. Workbook can be opened without corruption
   * 5. Contains at least one worksheet
   * 6. Header row is readable
   */
  async validateWorkbook(filePath: string): Promise<ExcelValidationResult> {
    const errors: string[] = [];

    if (!existsSync(filePath)) {
      return { valid: false, errors: [`File does not exist: ${filePath}`], rowCount: null, headers: null, worksheetCount: 0 };
    }

    const stat = statSync(filePath);
    if (stat.size < 1024) {
      errors.push(`File too small (${stat.size} bytes), likely empty or truncated`);
    }

    const ext = extname(filePath).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      errors.push(`Invalid file extension: ${ext}, expected .xlsx or .xls`);
    }

    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const worksheetCount = workbook.worksheets.length;
      if (worksheetCount === 0) {
        errors.push('Workbook contains no worksheets');
        return { valid: false, errors, rowCount: 0, headers: null, worksheetCount: 0 };
      }

      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        errors.push('Primary worksheet is null or undefined');
        return { valid: false, errors, rowCount: 0, headers: null, worksheetCount };
      }

      const rowCount = worksheet.rowCount;
      const firstRow = worksheet.getRow(1);
      const headers: string[] = [];

      firstRow.eachCell({ includeEmpty: false }, (cell) => {
        headers.push(String(cell.value ?? ''));
      });

      return {
        valid: errors.length === 0,
        errors,
        rowCount,
        headers: headers.length > 0 ? headers : null,
        worksheetCount,
      };
    } catch (error) {
      errors.push(`Workbook corruption or parse error: ${(error as Error).message}`);
      return { valid: false, errors, rowCount: null, headers: null, worksheetCount: 0 };
    }
  }
}

export class FileNamingEngine {
  formatInventoryName(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `Inventory_${yyyy}-${mm}-${dd}.xlsx`;
  }

  formatSalesName(fromDate: Date, toDate: Date): string {
    const formatD = (d: Date) => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    return `Sales_${formatD(fromDate)}_${formatD(toDate)}.xlsx`;
  }

  formatWithTemplate(template: string, params: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }
}

export class DownloadFileManager {
  /**
   * Resolve duplicate files by appending version suffix (_v2, _v3, etc.).
   * Never overwrites existing files silently.
   */
  handleCollision(destPath: string): string {
    if (!existsSync(destPath)) {
      return destPath;
    }

    const dir = dirname(destPath);
    const ext = extname(destPath);
    const base = basename(destPath, ext);

    for (let version = 2; version <= 99; version++) {
      const candidate = join(dir, `${base}_v${version}${ext}`);
      if (!existsSync(candidate)) {
        return candidate;
      }
    }

    // Fallback: timestamp suffix
    return join(dir, `${base}_${Date.now()}${ext}`);
  }

  /**
   * Move and rename a file to its final destination.
   */
  moveAndRename(sourcePath: string, destDir: string, newFileName: string): string {
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    const targetPath = join(destDir, newFileName);
    const finalPath = this.handleCollision(targetPath);

    try {
      renameSync(sourcePath, finalPath);
    } catch {
      // Fallback: copy + delete (cross-device move on Windows)
      copyFileSync(sourcePath, finalPath);
      try {
        unlinkSync(sourcePath);
      } catch {
        // Temp file deletion failure is non-fatal
      }
    }

    return finalPath;
  }

  /**
   * Copy file to archive folder with archive timestamp prefix.
   */
  archiveFile(filePath: string, archiveDir: string): string {
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }

    const name = basename(filePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = join(archiveDir, `${timestamp}_${name}`);

    copyFileSync(filePath, archivePath);
    return archivePath;
  }

  isTempFile(filePath: string): boolean {
    const tempExtensions = ['.crdownload', '.tmp', '.part', '.download'];
    const ext = extname(filePath).toLowerCase();
    return tempExtensions.includes(ext);
  }
}

export const FILE_TEMPLATES = {
  INVENTORY: 'Inventory_{YYYY-MM-DD}.xlsx',
  SALES: 'Sales_{FROM_DATE}_{TO_DATE}.xlsx',
} as const;
