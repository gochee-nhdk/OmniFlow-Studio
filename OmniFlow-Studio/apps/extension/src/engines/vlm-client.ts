import { getConfig } from '../shared/storage.js';
import type { AgentElement, AgentPageSnapshot } from './browser-agent.js';

export type VlmActionType = 'click' | 'fill' | 'press_key' | 'wait' | 'done' | 'abort';

export interface VlmNextAction {
  action: VlmActionType;
  /** 1-based Set-of-Mark index matching AgentElement.index */
  elementIndex?: number;
  /** Text to type (for 'fill') or KeyboardEvent key name (for 'press_key', e.g. 'Enter', 'Escape') */
  value?: string;
  /** Suggested wait duration in ms (for 'wait') */
  waitMs?: number;
  /** Short explanation of what the VLM observed and why it chose this action */
  reason: string;
  confidence?: number;
}

export interface VlmRequestInput {
  goal: string;
  currentState?: string;
  lastError?: string;
  consecutiveFailures?: number;
  screenshotDataUrl: string;
  snapshot: AgentPageSnapshot;
  apiKey?: string;
  model?: string;
}

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const VALID_ACTIONS = new Set<VlmActionType>(['click', 'fill', 'press_key', 'wait', 'done', 'abort']);

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) {
    throw new Error('Screenshot không đúng định dạng data URL base64.');
  }
  return { mimeType: match[1], data: match[2] };
}

function formatElementList(elements: AgentElement[]): string {
  if (!elements.length) return '(Không có phần tử tương tác nào được phát hiện)';
  return elements
    .slice(0, 120)
    .map((el) => {
      const disabledTag = el.disabled ? ' [DISABLED]' : '';
      const frameTag = el.frameId && el.frameId !== 0 ? ` [frame:${el.frameId}]` : '';
      return `[${el.index}] <${el.role}/${el.kind}> "${el.label}" (${el.rect.x},${el.rect.y},${el.rect.width}x${el.rect.height})${disabledTag}${frameTag}`;
    })
    .join('\n');
}

function parseVlmJson(rawText: string): VlmNextAction {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(cleaned) as Partial<VlmNextAction>;
  const action = parsed.action;
  if (!action || !VALID_ACTIONS.has(action)) {
    throw new Error(`VLM trả về action không hợp lệ: ${String(action)}`);
  }

  return {
    action,
    elementIndex: typeof parsed.elementIndex === 'number' ? parsed.elementIndex : undefined,
    value: typeof parsed.value === 'string' ? parsed.value : undefined,
    waitMs: typeof parsed.waitMs === 'number' ? parsed.waitMs : undefined,
    reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'VLM fallback decision',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
  };
}

/**
 * Calls Gemini 2.5 Flash with a captureVisibleTab() screenshot (with Set-of-Mark overlays)
 * and the structured element list to decide the next recovery/navigation action.
 */
export async function requestVlmNextAction(input: VlmRequestInput): Promise<VlmNextAction> {
  const config = input.apiKey ? null : await getConfig();
  const apiKey = (input.apiKey ?? config?.geminiApiKey ?? '').trim();
  if (!apiKey) {
    throw new Error('Gemini API Key chưa được cấu hình (geminiApiKey).');
  }

  const model = input.model || DEFAULT_GEMINI_MODEL;
  const { mimeType, data } = parseDataUrl(input.screenshotDataUrl);

  const prompt = [
    'You are a browser automation vision recovery agent for SAP Business One Web Client and POS RPFO.',
    'You are given a screenshot with numbered Set-of-Mark badges ([1], [2], ...) and a matching element list.',
    'Analyze the current screen, dismiss unexpected popups/modals if blocking, or select the best next element to achieve the goal.',
    '',
    `Goal: ${input.goal}`,
    input.currentState ? `Current detected state: ${input.currentState}` : '',
    input.lastError ? `Last error: ${input.lastError}` : '',
    typeof input.consecutiveFailures === 'number' ? `Consecutive failures: ${input.consecutiveFailures}` : '',
    `URL: ${input.snapshot.url}`,
    `Title: ${input.snapshot.title}`,
    input.snapshot.heading ? `Heading: ${input.snapshot.heading}` : '',
    '',
    'Set-of-Mark Elements:',
    formatElementList(input.snapshot.elements),
    '',
    'Respond ONLY with a valid JSON object matching this schema:',
    '{',
    '  "action": "click" | "fill" | "press_key" | "wait" | "done" | "abort",',
    '  "elementIndex": number (required for "click" or "fill", must match [index] above),',
    '  "value": string (required for "fill", or key name like "Enter" / "Escape" for "press_key"),',
    '  "waitMs": number (optional for "wait", e.g. 2000),',
    '  "reason": string (concise explanation),',
    '  "confidence": number (0.0 to 1.0)',
    '}',
  ]
    .filter(Boolean)
    .join('\n');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gemini API lỗi HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const rawText = payload.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!rawText.trim()) {
    throw new Error('Gemini API trả về phản hồi rỗng.');
  }

  return parseVlmJson(rawText);
}
