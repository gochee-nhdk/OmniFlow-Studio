// ============================================================
// OmniFlow Studio — Dynamic Naming Template Engine (Web Browser Safe)
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
    result = result.replace(new RegExp(`\\s*${esc}\\s*`, 'g'), replacement);
    result = result.replace(new RegExp(`${esc}+`, 'g'), replacement);
    result = result.replace(new RegExp(`^[\\s.${esc}]+|[\\s.${esc}]+$`, 'g'), '');
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

  let resolved = tmpl.replace(/\{\{?\s*([a-zA-Z0-9_-]+)\s*\}?\}/g, (_match, tokenKey) => {
    const val = getTokenValue(tokenKey);
    return sanitize ? sanitizeFileName(val, replacement) : val;
  });

  if (sanitize) {
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
