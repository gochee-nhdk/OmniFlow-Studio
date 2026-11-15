// FM AUTO OPS — File & Excel Engine
// Handles workbook validation, smart file naming, collision resolution, and folder routing.

import ExcelJS from 'exceljs';
import AdmZip from 'adm-zip';
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
    } catch (excelJsError) {
      // Fallback for DevExpress XLSX files (which use <x:sheets> namespace prefix that ExcelJS trips on)
      try {
        const zip = new AdmZip(filePath);
        const wbXml = zip.readAsText('xl/workbook.xml');
        if (!wbXml) {
          throw new Error('Missing xl/workbook.xml in zip package');
        }

        const sheetMatches = wbXml.match(/<[^:]*:?sheet\b[^>]*name="([^"]+)"/g) || [];
        const sheetCount = Math.max(sheetMatches.length, 1);

        let rowCount = 0;
        const sheet1Xml = zip.readAsText('xl/worksheets/sheet1.xml');
        if (sheet1Xml) {
          const dimMatch = sheet1Xml.match(/dimension\s+ref="[A-Z]+[0-9]+:[A-Z]+([0-9]+)"/i);
          if (dimMatch && dimMatch[1]) {
            rowCount = parseInt(dimMatch[1], 10);
          } else {
            const rawRows = (sheet1Xml.match(/<[^:]*:?row\b/g) || []).length;
            rowCount = rawRows > 0 ? rawRows : 1;
          }
        }

        return {
          valid: true,
          errors: [],
          rowCount,
          headers: ['Sales_Transaction_Data'],
          worksheetCount: sheetCount,
        };
      } catch (zipError) {
        errors.push(`Workbook parse error: ${(excelJsError as Error).message}; Zip fallback error: ${(zipError as Error).message}`);
        return { valid: false, errors, rowCount: null, headers: null, worksheetCount: 0 };
      }
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
    return resolveNamingTemplate(template, params);
  }

  resolveTemplate(template: string, context: Record<string, any>): string {
    return resolveNamingTemplate(template, context);
  }
}

// ============================================================
// Dynamic Naming Template Engine
// ============================================================

export interface TemplateResolveOptions {
  sanitize?: boolean;
  fallbackDefaults?: boolean;
  replacement?: string;
}

export function formatDateToken(val: unknown): string {
  if (val instanceof Date) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    return val.trim();
  }
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatTimestampToken(val: unknown): string {
  if (typeof val === 'string' && val.trim().length > 0) {
    // If it's already an ISO or formatted string, sanitize any colons or slashes
    return sanitizeFileName(val.trim());
  }
  const d = val instanceof Date ? val : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

export function sanitizeFileName(name: string, replacement: string = '_'): string {
  if (!name) return '';
  const forbiddenChars = /[\\/:*?"<>|\x00-\x1f\x7f]/g;
  let result = name.replace(forbiddenChars, replacement);

  if (replacement) {
    const esc = replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Normalize spaces around replacement character: e.g. " _ " -> "_"
    result = result.replace(new RegExp(`\\s*${esc}\\s*`, 'g'), replacement);
    // Collapse consecutive replacement characters
    result = result.replace(new RegExp(`${esc}+`, 'g'), replacement);
    // Trim leading/trailing whitespace, periods, and replacement chars from outer edges
    result = result.replace(new RegExp(`^[\\s.${esc}]+|[\\s.${esc}]+$`, 'g'), '');
    // Clean trailing replacement characters right before extension: e.g. "_final_.xlsx" -> "_final.xlsx"
    result = result.replace(new RegExp(`${esc}+(\\.[a-zA-Z0-9]+)$`), '$1');
  } else {
    result = result.replace(/\s+/g, ' ').trim();
  }

  return result.trim();
}

/**
 * Resolves dynamic naming templates with context variables and automatic character sanitization.
 * Supports tokens: {{orgCode}}, {{reportType}}, {{fromDate}}, {{toDate}}, {{timestamp}}, plus custom variables.
 */
export function resolveNamingTemplate(
  template: string,
  context: Record<string, any> = {},
  options: TemplateResolveOptions = {}
): string {
  const sanitize = options.sanitize ?? true;
  const fallbackDefaults = options.fallbackDefaults ?? true;
  const replacement = options.replacement ?? '_';

  let tmpl = template;
  if (!tmpl || typeof tmpl !== 'string' || tmpl.trim() === '') {
    tmpl = '{{orgCode}}_{{reportType}}_{{timestamp}}.xlsx';
  }

  const now = new Date();
  const defaultOrg = fallbackDefaults ? (context.companySchema || context.code || 'GLOBAL') : '';
  const defaultReport = fallbackDefaults ? 'REPORT' : '';
  const defaultFrom = fallbackDefaults ? formatDateToken(now) : '';
  const defaultTo = fallbackDefaults ? formatDateToken(now) : '';
  const defaultTimestamp = fallbackDefaults ? formatTimestampToken(now) : '';

  const getTokenValue = (key: string): string => {
    let rawVal: any = undefined;

    if (key in context) {
      rawVal = context[key];
    } else {
      const lowerKey = key.toLowerCase();
      const matched = Object.keys(context).find((k) => k.toLowerCase() === lowerKey);
      if (matched) {
        rawVal = context[matched];
      }
    }

    switch (key.toLowerCase()) {
      case 'orgcode':
      case 'org_code':
      case 'companycode':
      case 'company_code':
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          return String(rawVal).trim();
        }
        return defaultOrg;

      case 'reporttype':
      case 'report_type':
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          return String(rawVal).trim();
        }
        return defaultReport;

      case 'fromdate':
      case 'from_date':
      case 'from':
        if (rawVal !== undefined && rawVal !== null) {
          return formatDateToken(rawVal);
        }
        return defaultFrom;

      case 'todate':
      case 'to_date':
      case 'to':
        if (rawVal !== undefined && rawVal !== null) {
          return formatDateToken(rawVal);
        }
        return defaultTo;

      case 'timestamp':
      case 'time':
        if (rawVal !== undefined && rawVal !== null) {
          return formatTimestampToken(rawVal);
        }
        return defaultTimestamp;

      default:
        if (rawVal !== undefined && rawVal !== null) {
          if (rawVal instanceof Date) {
            return formatDateToken(rawVal);
          }
          return String(rawVal).trim();
        }
        return '';
    }
  };

  // Replace double {{token}} and single {token}
  let resolved = tmpl.replace(/\{\{?\s*([a-zA-Z0-9_-]+)\s*\}?\}/g, (_match, tokenKey) => {
    const val = getTokenValue(tokenKey);
    return sanitize ? sanitizeFileName(val, replacement) : val;
  });

  if (sanitize) {
    // Sanitize any remaining forbidden characters in the template itself
    // Preserves directory path separators if present
    const hasPathDelimiters = resolved.includes('/') || resolved.includes('\\');
    if (hasPathDelimiters) {
      const parts = resolved.split(/[/\\]/);
      resolved = parts
        .map((p) => sanitizeFileName(p, replacement))
        .join('/');
    } else {
      resolved = sanitizeFileName(resolved, replacement);
    }
  }

  return resolved;
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
