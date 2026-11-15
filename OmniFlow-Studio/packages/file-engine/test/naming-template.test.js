const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  resolveNamingTemplate,
  sanitizeFileName,
  formatDateToken,
  formatTimestampToken,
  FileNamingEngine,
} = require('../dist/index.js');

describe('Dynamic Naming Template Engine', () => {
  describe('resolveNamingTemplate() - Standard Tokens', () => {
    test('resolves standard tokens {{orgCode}}, {{reportType}}, {{fromDate}}, {{toDate}}', () => {
      const template = '{{orgCode}}_{{reportType}}_{{fromDate}}_{{toDate}}.xlsx';
      const context = {
        orgCode: 'FM_PRO',
        reportType: 'SALES',
        fromDate: '2026-11-01',
        toDate: '2026-11-14',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'FM_PRO_SALES_2026-11-01_2026-11-14.xlsx');
    });

    test('resolves single brace tokens {orgCode}_{reportType}', () => {
      const template = '{orgCode}_{reportType}_{timestamp}.xlsx';
      const context = {
        orgCode: 'LARIA_HQ',
        reportType: 'INVENTORY',
        timestamp: '20261114_100000',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'LARIA_HQ_INVENTORY_20261114_100000.xlsx');
    });

    test('resolves Date objects passed in fromDate and toDate', () => {
      const template = '{{reportType}}_{{fromDate}}_{{toDate}}.xlsx';
      const context = {
        reportType: 'TRANSACTION',
        fromDate: new Date(2026, 10, 5), // Month is 0-indexed: 10 = Nov
        toDate: new Date(2026, 10, 12),
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'TRANSACTION_2026-11-05_2026-11-12.xlsx');
    });

    test('supports custom variables in template', () => {
      const template = '{{orgCode}}_{{reportType}}_Store-{{storeId}}_Sloc-{{slocId}}.xlsx';
      const context = {
        orgCode: 'FM01',
        reportType: 'STOCK',
        storeId: 'DC01',
        slocId: 'KHO_TONG',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'FM01_STOCK_Store-DC01_Sloc-KHO_TONG.xlsx');
    });

    test('handles case-insensitive token lookups', () => {
      const template = '{{ORGCODE}}_{{reporttype}}_{{fromdate}}.xlsx';
      const context = {
        orgCode: 'GLOBAL_CORP',
        reportType: 'AUDIT',
        fromDate: '2026-05-01',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'GLOBAL_CORP_AUDIT_2026-05-01.xlsx');
    });
  });

  describe('resolveNamingTemplate() - Fallbacks & Defaults', () => {
    test('uses fallback defaults when context is empty', () => {
      const template = '{{orgCode}}_{{reportType}}.xlsx';
      const result = resolveNamingTemplate(template, {});
      assert.strictEqual(result, 'GLOBAL_REPORT.xlsx');
    });

    test('uses default template pattern when template string is empty', () => {
      const context = {
        orgCode: 'ACME',
        reportType: 'EXPENSE',
        timestamp: '20261114_120000',
      };

      const result = resolveNamingTemplate('', context);
      assert.strictEqual(result, 'ACME_EXPENSE_20261114_120000.xlsx');
    });

    test('uses companySchema or code as orgCode fallback if orgCode not provided', () => {
      const template = '{{orgCode}}_{{reportType}}.xlsx';
      const context = {
        companySchema: 'FM_PRO_SCHEMA',
        reportType: 'ORDERS',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'FM_PRO_SCHEMA_ORDERS.xlsx');
    });

    test('replaces missing custom tokens with empty string', () => {
      const template = 'Report_{{customVar}}_{{reportType}}.xlsx';
      const context = {
        reportType: 'SUMMARY',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'Report_SUMMARY.xlsx');
    });
  });

  describe('resolveNamingTemplate() - Forbidden Character Sanitization', () => {
    test('sanitizes illegal path/filename characters in token values', () => {
      const template = '{{orgCode}}_{{reportType}}.xlsx';
      const context = {
        orgCode: 'FM/PRO:LARIA*?',
        reportType: 'SALES<MONTH>"|',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'FM_PRO_LARIA_SALES_MONTH.xlsx');
      assert.doesNotMatch(result, /[\\/:*?"<>|]/);
    });

    test('sanitizes illegal characters in template itself', () => {
      const template = 'Audit: {{orgCode}} *Special* <Final>?.xlsx';
      const context = {
        orgCode: 'CORP',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'Audit_CORP_Special_Final.xlsx');
      assert.doesNotMatch(result, /[\\/:*?"<>|]/);
    });

    test('preserves forward slash path delimiters when directory path is included', () => {
      const template = 'export/reports/{{orgCode}}_{{reportType}}.xlsx';
      const context = {
        orgCode: 'FM_CORP',
        reportType: 'DAILY',
      };

      const result = resolveNamingTemplate(template, context);
      assert.strictEqual(result, 'export/reports/FM_CORP_DAILY.xlsx');
    });

    test('replaces colon and backslashes in Windows-style paths safely', () => {
      const template = 'C:\\Reports\\{{orgCode}}_{{timestamp}}.xlsx';
      const context = {
        orgCode: 'FM_HQ',
        timestamp: '2026-11-14T10:30:00Z',
      };

      const result = resolveNamingTemplate(template, context);
      assert.doesNotMatch(result, /[*?"<>|]/);
      assert.ok(result.includes('FM_HQ'));
    });
  });

  describe('sanitizeFileName() helper', () => {
    test('replaces illegal characters with replacement character', () => {
      const raw = 'Invalid:Name*With?Illegal<Chars>|And"Quotes.xlsx';
      const sanitized = sanitizeFileName(raw);
      assert.strictEqual(sanitized, 'Invalid_Name_With_Illegal_Chars_And_Quotes.xlsx');
    });

    test('collapses duplicate replacement characters and trims edges', () => {
      const raw = '  ..///Multiple::::Symbols***..  ';
      const sanitized = sanitizeFileName(raw);
      assert.strictEqual(sanitized, 'Multiple_Symbols');
    });

    test('handles empty or null string gracefully', () => {
      assert.strictEqual(sanitizeFileName(''), '');
      assert.strictEqual(sanitizeFileName(null), '');
      assert.strictEqual(sanitizeFileName(undefined), '');
    });

    test('handles custom replacement delimiter', () => {
      const raw = 'Report:Annual*Summary';
      const sanitized = sanitizeFileName(raw, '-');
      assert.strictEqual(sanitized, 'Report-Annual-Summary');
    });
  });

  describe('Date and Timestamp token formatting helpers', () => {
    test('formatDateToken formats Date instance to YYYY-MM-DD', () => {
      const date = new Date(2026, 0, 15);
      assert.strictEqual(formatDateToken(date), '2026-01-15');
    });

    test('formatDateToken preserves valid date strings', () => {
      assert.strictEqual(formatDateToken('2026-12-31'), '2026-12-31');
    });

    test('formatTimestampToken generates sanitized alphanumeric timestamp', () => {
      const ts = formatTimestampToken(new Date(2026, 5, 20, 14, 30, 45));
      assert.strictEqual(ts, '20260620_143045');
    });
  });

  describe('FileNamingEngine integration', () => {
    test('resolveTemplate delegates to resolveNamingTemplate', () => {
      const engine = new FileNamingEngine();
      const result = engine.resolveTemplate('{{orgCode}}_{{reportType}}.xlsx', {
        orgCode: 'STORE01',
        reportType: 'INVENTORY',
      });
      assert.strictEqual(result, 'STORE01_INVENTORY.xlsx');
    });

    test('formatWithTemplate delegates to resolveNamingTemplate', () => {
      const engine = new FileNamingEngine();
      const result = engine.formatWithTemplate('{orgCode}_{reportType}.xlsx', {
        orgCode: 'STORE02',
        reportType: 'RECEIPT',
      });
      assert.strictEqual(result, 'STORE02_RECEIPT.xlsx');
    });
  });
});
