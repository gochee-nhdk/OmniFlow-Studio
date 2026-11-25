export interface AgentElement {
  index: number;
  role: string;
  label: string;
  kind: string;
  rect: { x: number; y: number; width: number; height: number };
  disabled: boolean;
}

export interface AgentPageSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  heading: string;
  elements: AgentElement[];
}

/** Runs in the inspected page. Returns a compact, secret-safe DOM view. */
export function inspectPage(): AgentPageSnapshot {
  const selector = 'button,a,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]';
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const elements: AgentElement[] = [];
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width < 2 || rect.height < 2 || style.visibility === 'hidden' || style.display === 'none') continue;
    const input = el instanceof HTMLInputElement ? el : null;
    const labelText = input?.labels ? Array.from(input.labels).map((label) => label.innerText).join(' ') : '';
    const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || labelText || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 140);
    const kind = input?.type || el.tagName.toLowerCase();
    if (!label && !['checkbox', 'radio', 'submit', 'button'].includes(kind)) continue;
    elements.push({
      index: elements.length,
      role: el.getAttribute('role') || el.tagName.toLowerCase(),
      label: label || kind,
      kind,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      disabled: ('disabled' in el && Boolean((el as HTMLButtonElement).disabled)) || el.getAttribute('aria-disabled') === 'true',
    });
    if (elements.length >= 100) break;
  }
  return {
    url: location.href,
    title: document.title.slice(0, 160),
    viewport: { width: innerWidth, height: innerHeight },
    heading: (document.querySelector('h1')?.textContent || '').trim().slice(0, 200),
    elements,
  };
}

/** Re-identifies the selected visible control before acting, avoiding stale coordinates. */
export function actOnPage(index: number, operation: 'click' | 'fill', value: string | undefined, expectedLabel: string): { ok: boolean; message: string } {
  const selector = 'button,a,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]';
  const visible: HTMLElement[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width >= 2 && rect.height >= 2 && style.visibility !== 'hidden' && style.display !== 'none') visible.push(el);
  }
  const target = visible[index];
  if (!target) return { ok: false, message: 'Phần tử không còn hiển thị; hãy quét lại trang.' };
  const inputTarget = target instanceof HTMLInputElement ? target : null;
  const labelText = inputTarget?.labels ? Array.from(inputTarget.labels).map((label) => label.innerText).join(' ') : '';
  const currentLabel = (target.getAttribute('aria-label') || target.getAttribute('placeholder') || labelText || target.innerText || target.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 140);
  if (currentLabel !== expectedLabel) return { ok: false, message: 'Nhãn phần tử đã thay đổi; hãy quét lại trang trước khi thao tác.' };
  if (('disabled' in target && Boolean((target as HTMLButtonElement).disabled)) || target.getAttribute('aria-disabled') === 'true') {
    return { ok: false, message: 'Phần tử đang bị vô hiệu hóa.' };
  }
  if (operation === 'click') {
    const wording = `${target.innerText || ''} ${target.getAttribute('aria-label') || ''} ${target.getAttribute('title') || ''}`.toLocaleLowerCase();
    if (/\b(delete|remove|submit|send|pay|payment|purchase|order|confirm|save|xóa|xoá|gửi|thanh toán|đặt hàng|xác nhận|lưu)\b/i.test(wording)) {
      return { ok: false, message: 'Nút có thể tạo thay đổi hoặc giao dịch nhạy cảm; hãy thao tác thủ công trên trang.' };
    }
    target.click();
    return { ok: true, message: 'Đã nhấn phần tử.' };
  }
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable)) {
    return { ok: false, message: 'Đích đã chọn không phải trường nhập liệu.' };
  }
  if (target instanceof HTMLInputElement && ['password', 'hidden', 'file'].includes(target.type)) {
    return { ok: false, message: 'Agent không đọc hoặc điền trường mật khẩu, ẩn hoặc tệp.' };
  }
  if (target instanceof HTMLSelectElement) {
    const option = Array.from(target.options).find((item) => item.label === value || item.value === value);
    if (!option) return { ok: false, message: 'Không tìm thấy lựa chọn khớp trong danh sách.' };
    target.value = option.value;
  } else if (target.isContentEditable) {
    target.textContent = value || '';
  } else {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
    setter?.call(target, value || '');
  }
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, message: 'Đã điền trường và phát sự kiện input/change.' };
}
