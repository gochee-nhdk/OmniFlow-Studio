// FM AUTO OPS — High-Fidelity Mock DOM Engine
// Simulates DOM elements, DevExtreme widgets (dxDateBox, dxDataGrid), SAP SLD logon forms,
// loading wave indicators, and DOM event dispatching.

export class MockClassList {
  constructor(element) {
    this.element = element;
    this._classes = new Set();
    if (element.className) {
      for (const c of element.className.split(/\s+/)) {
        if (c) this._classes.add(c);
      }
    }
  }

  contains(name) {
    return this._classes.has(name);
  }

  add(...names) {
    for (const n of names) {
      if (n) this._classes.add(n);
    }
    this._sync();
  }

  remove(...names) {
    for (const n of names) {
      this._classes.delete(n);
    }
    this._sync();
  }

  toggle(name, force) {
    if (force !== undefined) {
      if (force) this.add(name);
      else this.remove(name);
      return force;
    }
    if (this.contains(name)) {
      this.remove(name);
      return false;
    } else {
      this.add(name);
      return true;
    }
  }

  _sync() {
    this.element._className = Array.from(this._classes).join(' ');
  }
}

export class MockElement {
  constructor(tagName = 'div', document = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.id = '';
    this._className = '';
    this.classList = new MockClassList(this);
    this.attributes = new Map();
    this.style = {
      display: '',
      visibility: '',
      width: '',
      height: '',
    };
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this._value = '';
    this.checked = false;
    this.disabled = false;
    this.selectedIndex = 0;
    this._textContent = '';
    this.__dxInstance = null;
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val || '';
    this.classList = new MockClassList(this);
  }

  get value() {
    return this._value;
  }

  set value(val) {
    this._value = String(val ?? '');
  }

  get textContent() {
    const childText = this.children.map(c => c.textContent).filter(Boolean).join(' ');
    if (this._textContent && childText) {
      return `${this._textContent} ${childText}`.trim();
    }
    return this._textContent || childText || '';
  }

  set textContent(val) {
    this._textContent = String(val ?? '');
    this.children = [];
  }

  get text() {
    return this.textContent;
  }

  set text(val) {
    this.textContent = val;
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(val) {
    this.textContent = val;
  }

  get options() {
    if (this.tagName === 'SELECT') {
      return this.children.filter(c => c.tagName === 'OPTION');
    }
    return [];
  }

  getAttribute(name) {
    const lower = name.toLowerCase();
    if (lower === 'id') return this.id || null;
    if (lower === 'class') return this.className || null;
    if (lower === 'value') return this._value || null;
    if (lower === 'disabled') return this.disabled ? '' : null;
    if (lower === 'checked') return this.checked ? '' : null;
    return this.attributes.get(lower) ?? null;
  }

  setAttribute(name, val) {
    const lower = name.toLowerCase();
    const strVal = String(val ?? '');
    this.attributes.set(lower, strVal);
    if (lower === 'id') this.id = strVal;
    if (lower === 'class') this.className = strVal;
    if (lower === 'value') this._value = strVal;
    if (lower === 'disabled') this.disabled = true;
    if (lower === 'checked') this.checked = true;
  }

  removeAttribute(name) {
    const lower = name.toLowerCase();
    this.attributes.delete(lower);
    if (lower === 'id') this.id = '';
    if (lower === 'class') this.className = '';
    if (lower === 'value') this._value = '';
    if (lower === 'disabled') this.disabled = false;
    if (lower === 'checked') this.checked = false;
  }

  hasAttribute(name) {
    return this.getAttribute(name) !== null;
  }

  appendChild(child) {
    if (child.parentNode) {
      child.parentNode.removeChild(child);
    }
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  insertBefore(newChild, refChild) {
    if (newChild.parentNode) {
      newChild.parentNode.removeChild(newChild);
    }
    newChild.parentNode = this;
    newChild.ownerDocument = this.ownerDocument;
    const idx = this.children.indexOf(refChild);
    if (idx === -1) {
      this.children.push(newChild);
    } else {
      this.children.splice(idx, 0, newChild);
    }
    return newChild;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  dispatchEvent(event) {
    event.target = this;
    event.currentTarget = this;
    const list = this.listeners.get(event.type) || [];
    for (const listener of list) {
      try {
        listener.call(this, event);
      } catch (e) {
        console.error('Event listener error:', e);
      }
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return true;
  }

  click() {
    if (this.disabled) return;
    if (this.getAttribute('type') === 'checkbox') {
      this.checked = !this.checked;
    }
    this.dispatchEvent(new MockEvent('click', { bubbles: true }));
  }

  focus() {
    this.dispatchEvent(new MockEvent('focus', { bubbles: false }));
  }

  blur() {
    this.dispatchEvent(new MockEvent('blur', { bubbles: false }));
  }

  // Selector matching
  matches(selector) {
    return matchSelector(this, selector);
  }

  querySelector(selector) {
    return querySelectorSingle(this, selector);
  }

  querySelectorAll(selector) {
    const results = [];
    querySelectorMulti(this, selector, results);
    return results;
  }
}

export class MockEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.bubbles = false;
  }
}

export class MockCustomEvent extends MockEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options.detail;
  }
}

// Selector parsing and matching
function matchSingleCompound(el, compound) {
  // Handles :text("foo"), :has-text("foo"), :visible, [attr="val"], [attr*="val" i], #id, .class, tag
  let remaining = compound.trim();
  if (!remaining) return false;

  // :visible (must check entire ancestor chain)
  if (remaining.includes(':visible')) {
    let cur = el;
    while (cur) {
      if (cur.style && (cur.style.display === 'none' || cur.style.visibility === 'hidden')) {
        return false;
      }
      cur = cur.parentNode;
    }
    remaining = remaining.replace(':visible', '').trim();
    if (!remaining) return true;
  }

  // :text("...") or :has-text("...") or unquoted :has-text(Search)
  const textMatch = remaining.match(/:(?:has-)?text\((?:(["'])(.*?)\1|([^)]+))\)/);
  if (textMatch) {
    const isHasText = textMatch[0].startsWith(':has-text');
    const expected = textMatch[2] !== undefined ? textMatch[2] : textMatch[3];
    const actual = el.textContent || '';
    if (!actual.toLowerCase().includes(expected.toLowerCase())) {
      return false;
    }
    // For :text(...), do not match parent containers if a child element also contains the text
    if (!isHasText && el.children && el.children.some(c => (c.textContent || '').toLowerCase().includes(expected.toLowerCase()))) {
      return false;
    }
    remaining = remaining.replace(textMatch[0], '').trim();
    if (!remaining) return true;
  }

  // Check attributes [attr="val"] or [attr*="val" i] or [attr] with optional spaces around =
  const attrRegex = /\[\s*([a-zA-Z0-9_-]+)\s*(?:([*^$]?=)\s*(["']?)(.*?)\3\s*( i)?)?\s*\]/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(remaining)) !== null) {
    const attrName = attrMatch[1].toLowerCase();
    const op = attrMatch[2];
    const attrVal = attrMatch[4];
    const isCaseInsensitive = Boolean(attrMatch[5]);

    const actual = el.getAttribute(attrName);
    if (actual === null) return false;

    if (op) {
      const a = isCaseInsensitive ? actual.toLowerCase() : actual;
      const e = isCaseInsensitive ? attrVal.toLowerCase() : attrVal;
      if (op === '=' && a !== e) return false;
      if (op === '*=' && !a.includes(e)) return false;
      if (op === '^=' && !a.startsWith(e)) return false;
      if (op === '$=' && !a.endsWith(e)) return false;
    }
  }
  remaining = remaining.replace(attrRegex, '').trim();
  if (!remaining) return true;

  // Check ID #some-id
  const idMatch = remaining.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    if (el.id !== idMatch[1]) return false;
    remaining = remaining.replace(idMatch[0], '').trim();
    if (!remaining) return true;
  }

  // Check Classes .some-class
  const classMatches = remaining.match(/\.([a-zA-Z0-9_-]+)/g);
  if (classMatches) {
    for (const cm of classMatches) {
      const cls = cm.slice(1);
      if (!el.classList.contains(cls)) return false;
    }
    remaining = remaining.replace(/\.([a-zA-Z0-9_-]+)/g, '').trim();
    if (!remaining) return true;
  }

  // Check Tag name
  if (remaining) {
    if (remaining.toUpperCase() !== el.tagName) return false;
  }

  return true;
}

function splitSelectorComma(selector) {
  const parts = [];
  let current = '';
  let inQuote = null;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === '(') {
      parenDepth++;
      current += ch;
    } else if (ch === ')') {
      parenDepth--;
      current += ch;
    } else if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      bracketDepth--;
      current += ch;
    } else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function splitSelectorDescendants(selector) {
  const parts = [];
  let current = '';
  let inQuote = null;
  let parenDepth = 0;
  let bracketDepth = 0;

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
    } else if (ch === '(') {
      parenDepth++;
      current += ch;
    } else if (ch === ')') {
      parenDepth--;
      current += ch;
    } else if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      bracketDepth--;
      current += ch;
    } else if (ch === '>' && inQuote === null && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
        current = '';
      }
      parts.push('>');
    } else if (/\s/.test(ch) && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function matchSelector(el, selector) {
  // If comma separated, match any with quote/bracket awareness
  const commaParts = splitSelectorComma(selector);
  if (commaParts.length > 1) {
    return commaParts.some(p => matchSelector(el, p));
  }

  const parts = splitSelectorDescendants(selector);
  if (parts.length === 0) return false;
  if (parts.length === 1) {
    return matchSingleCompound(el, parts[0]);
  }

  // Descendant / child check
  const targetCompound = parts[parts.length - 1];
  if (!matchSingleCompound(el, targetCompound)) return false;

  let currentParent = el.parentNode;
  let i = parts.length - 2;
  while (i >= 0) {
    if (parts[i] === '>') {
      i--;
      if (i < 0) return false;
      const parentCompound = parts[i];
      if (!currentParent || !matchSingleCompound(currentParent, parentCompound)) {
        return false;
      }
      currentParent = currentParent.parentNode;
      i--;
    } else {
      const ancestorCompound = parts[i];
      let matched = false;
      while (currentParent) {
        if (matchSingleCompound(currentParent, ancestorCompound)) {
          matched = true;
          currentParent = currentParent.parentNode;
          break;
        }
        currentParent = currentParent.parentNode;
      }
      if (!matched) return false;
      i--;
    }
  }
  return true;
}

function querySelectorSingle(root, selector) {
  for (const child of root.children) {
    if (matchSelector(child, selector)) {
      return child;
    }
    const found = querySelectorSingle(child, selector);
    if (found) return found;
  }
  return null;
}

function querySelectorMulti(root, selector, results) {
  for (const child of root.children) {
    if (matchSelector(child, selector)) {
      results.push(child);
    }
    querySelectorMulti(child, selector, results);
  }
}

export class MockDocument {
  constructor() {
    this.body = new MockElement('BODY', this);
    this.head = new MockElement('HEAD', this);
    this.root = new MockElement('HTML', this);
    this.root.appendChild(this.head);
    this.root.appendChild(this.body);
  }

  createElement(tagName) {
    return new MockElement(tagName, this);
  }

  getElementById(id) {
    const results = [];
    querySelectorMulti(this.root, `#${id}`, results);
    return results[0] || null;
  }

  querySelector(selector) {
    if (matchSelector(this.root, selector)) return this.root;
    return querySelectorSingle(this.root, selector);
  }

  querySelectorAll(selector) {
    const results = [];
    if (matchSelector(this.root, selector)) results.push(this.root);
    querySelectorMulti(this.root, selector, results);
    return Array.from(new Set(results));
  }
}

export class MockWindow {
  constructor(document = null) {
    this.document = document || new MockDocument();
    this.document.window = this;
    this.location = {
      href: 'about:blank',
      search: '',
      pathname: '',
      origin: 'http://localhost',
    };
    this.__capturedBlobs = [];
    this.__buttonClicked = null;
    this.__searchClicks = 0;
    this.__clickTimestamps = [];
    this.__waveHideTimestamp = null;

    // Blob & URL mock
    const capturedBlobs = this.__capturedBlobs;
    this.Blob = class MockBlob {
      constructor(parts, options = {}) {
        this.parts = parts;
        this.type = options.type || '';
        this.size = parts.reduce((acc, p) => acc + (p?.length || (typeof p === 'string' ? Buffer.byteLength(p) : 0)), 0);
      }
    };

    this.FileReader = class MockFileReader {
      readAsDataURL(blob) {
        const content = (blob && blob.parts) ? blob.parts.join('') : 'MOCK_EXCEL_XLSX_BINARY_BUFFER_OVER_500_BYTES_FOR_SALES_REPORT_DATA_TRANSACTION';
        const payload = content.repeat(Math.ceil(600 / Math.max(content.length, 1)));
        const dummyBase64 = Buffer.from(payload).toString('base64');
        this.result = `data:${blob?.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};base64,${dummyBase64}`;
        if (this.onload) this.onload();
      }
    };

    this.URL = {
      createObjectURL: (blob) => {
        const url = `blob:http://localhost/${Math.random().toString(36).slice(2)}`;
        if (blob instanceof this.Blob || (blob && blob.parts)) {
          const reader = new this.FileReader();
          reader.onload = () => {
            const targetBlobs = this.__capturedBlobs || capturedBlobs;
            targetBlobs.push({
              type: blob.type,
              size: blob.size,
              dataUrl: reader.result,
              url,
            });
          };
          reader.readAsDataURL(blob);
        }
        return url;
      },
      revokeObjectURL: () => {},
    };

    this.Event = MockEvent;
    this.CustomEvent = MockCustomEvent;

    // DevExtreme mock
    this.DevExpress = {
      ui: {
        dxDateBox: {
          getInstance: (el) => {
            if (!el) return null;
            if (!el.__dxInstance) {
              el.__dxInstance = {
                type: 'dxDateBox',
                element: el,
                options: {
                  value: new Date(),
                  displayFormat: 'dd/MM/yyyy',
                },
                option(name, value) {
                  if (arguments.length === 1) {
                    return this.options[name];
                  }
                  this.options[name] = value;
                  if (name === 'value' && value instanceof Date) {
                    const d = String(value.getDate()).padStart(2, '0');
                    const m = String(value.getMonth() + 1).padStart(2, '0');
                    const y = value.getFullYear();
                    const formatted = `${d}/${m}/${y}`;
                    const input = el.querySelector('input.dx-texteditor-input');
                    if (input) {
                      input.value = formatted;
                    }
                  }
                  return value;
                },
              };
            }
            return el.__dxInstance;
          },
        },
        dxDataGrid: {
          getInstance: (el) => {
            if (!el) return null;
            if (!el.__dxInstance) {
              el.__dxInstance = {
                type: 'dxDataGrid',
                element: el,
                columnOptions: new Map(),
                columnOption(field, name, value) {
                  if (!this.columnOptions.has(field)) {
                    this.columnOptions.set(field, {});
                  }
                  const col = this.columnOptions.get(field);
                  if (arguments.length === 2) {
                    return col[name];
                  }
                  col[name] = value;
                  // Trigger grid row re-filter
                  this.applyFiltering();
                  return value;
                },
                applyFiltering() {
                  const rows = el.querySelectorAll('.dx-data-row');
                  for (const row of rows) {
                    let visible = true;
                    for (const [field, col] of this.columnOptions.entries()) {
                      if (col.filterValues && Array.isArray(col.filterValues) && col.filterValues.length > 0) {
                        const cell = row.querySelector(`[data-field="${field}"]`) || row.querySelector(`.cell-${field}`);
                        if (cell) {
                          const val = cell.textContent.trim();
                          const matches = col.filterValues.some(fv => val.includes(fv) || fv.includes(val));
                          if (col.filterType === 'exclude' ? matches : !matches) {
                            visible = false;
                            break;
                          }
                        }
                      }
                    }
                    row.style.display = visible ? '' : 'none';
                  }
                },
              };
            }
            return el.__dxInstance;
          },
        },
      },
    };
  }
}

// Helper DOM Page Builders

export function createMockSAPSLDDocument(options = {}) {
  const doc = new MockDocument();
  const win = new MockWindow(doc);

  const table = doc.createElement('table');
  table.className = 'sbo_layer';

  // Server row
  const trServer = doc.createElement('tr');
  const tdServer = doc.createElement('td');
  const selectServer = doc.createElement('select');
  selectServer.id = 'sbo_dbserver';
  if (options.servers) {
    for (const s of options.servers) {
      const opt = doc.createElement('option');
      opt.value = s.value;
      opt.textContent = s.text || s.value;
      selectServer.appendChild(opt);
    }
  } else {
    const opt = doc.createElement('option');
    opt.value = 'SBO@172.16.0.201:30013';
    opt.textContent = 'SBO@172.16.0.201:30013';
    selectServer.appendChild(opt);
  }
  tdServer.appendChild(selectServer);
  trServer.appendChild(tdServer);
  table.appendChild(trServer);

  // Company row
  const trComp = doc.createElement('tr');
  const tdComp = doc.createElement('td');
  const refreshBtn = doc.createElement('input');
  refreshBtn.id = 'refresh_company';
  refreshBtn.setAttribute('type', 'button');
  refreshBtn.value = 'Refresh';
  if (options.servers && options.servers.length === 0) {
    refreshBtn.disabled = true;
  }

  const selectCompany = doc.createElement('select');
  selectCompany.id = 'sbo_company';

  // Async company options settlement
  if (options.initialCompanyOptions) {
    for (const c of options.initialCompanyOptions) {
      const opt = doc.createElement('option');
      opt.value = c.value;
      opt.textContent = c.text || c.value;
      selectCompany.appendChild(opt);
    }
  }

  const customCompany = doc.createElement('input');
  customCompany.id = 'sbo_custom_company';
  customCompany.style.display = 'none';

  refreshBtn.addEventListener('click', () => {
    // If dbserver has no selection, hides sbo_company
    if (selectServer.options.length === 0) {
      selectCompany.style.display = 'none';
      customCompany.style.display = '';
    }
  });

  tdComp.appendChild(refreshBtn);
  tdComp.appendChild(selectCompany);
  tdComp.appendChild(customCompany);
  trComp.appendChild(tdComp);
  table.appendChild(trComp);

  // User row
  const trUser = doc.createElement('tr');
  const tdUser = doc.createElement('td');
  const inputUser = doc.createElement('input');
  inputUser.id = 'sbo_user';
  inputUser.setAttribute('type', 'text');
  tdUser.appendChild(inputUser);
  trUser.appendChild(tdUser);
  table.appendChild(trUser);

  // Password row
  const trPass = doc.createElement('tr');
  const tdPass = doc.createElement('td');
  const inputPass = doc.createElement('input');
  inputPass.id = 'sbo_password';
  inputPass.setAttribute('type', 'password');
  tdPass.appendChild(inputPass);
  trPass.appendChild(tdPass);
  table.appendChild(trPass);

  // Logon button
  const divLogon = doc.createElement('div');
  divLogon.className = 'sbo_logon';
  const btnLogon = doc.createElement('input');
  btnLogon.id = 'logon_sbo_btn';
  btnLogon.setAttribute('type', 'button');
  btnLogon.value = 'Log On';
  divLogon.appendChild(btnLogon);

  // Concurrent messagebox modal
  const modalMsg = doc.createElement('div');
  modalMsg.id = 'messagebox';
  modalMsg.style.display = 'none';
  const modalText = doc.createElement('div');
  modalText.className = 'dialog_content';
  modalText.textContent = options.concurrentText || 'Another user has already logged in. Do you want to continue?';
  const btnYes = doc.createElement('button');
  btnYes.textContent = 'Yes';
  btnYes.className = 'btn-yes';
  modalMsg.appendChild(modalText);
  modalMsg.appendChild(btnYes);

  // Shell header (authenticated state)
  const shellHeader = doc.createElement('div');
  shellHeader.id = 'shell-header';
  const shellTitle = doc.createElement('span');
  shellTitle.className = 'sapMShellTitle';
  shellTitle.textContent = 'Purchasing - A/P';
  shellHeader.appendChild(shellTitle);

  btnLogon.addEventListener('click', () => {
    if (options.triggerConcurrentOnSubmit) {
      modalMsg.style.display = '';
    } else if (inputUser.value && inputPass.value) {
      if (!shellHeader.parentNode) {
        doc.body.appendChild(shellHeader);
      }
    }
  });

  btnYes.addEventListener('click', () => {
    modalMsg.style.display = 'none';
    if (!shellHeader.parentNode) {
      doc.body.appendChild(shellHeader);
    }
  });

  doc.body.appendChild(table);
  doc.body.appendChild(divLogon);
  doc.body.appendChild(modalMsg);
  if (options.alreadyAuthenticated) {
    doc.body.appendChild(shellHeader);
  }

  return { doc, win, selectCompany, inputUser, inputPass, btnLogon, modalMsg, shellHeader };
}

export function createMockPOSSalesDocument(options = {}) {
  const doc = new MockDocument();
  const win = new MockWindow(doc);

  // Filter form
  const filterForm = doc.createElement('div');
  filterForm.className = 'filter-container';

  // dx-date-box from
  const fromBox = doc.createElement('dx-date-box');
  fromBox.className = 'dx-datebox dx-widget';
  const fromInput = doc.createElement('input');
  fromInput.className = 'dx-texteditor-input';
  fromInput.value = '14/11/2026';
  fromBox.appendChild(fromInput);
  const fromInst = win.DevExpress.ui.dxDateBox.getInstance(fromBox);
  fromInst.options.value = new Date(2026, 10, 14);

  // dx-date-box to
  const toBox = doc.createElement('dx-date-box');
  toBox.className = 'dx-datebox dx-widget';
  const toInput = doc.createElement('input');
  toInput.className = 'dx-texteditor-input';
  toInput.value = '14/11/2026';
  toBox.appendChild(toInput);
  const toInst = win.DevExpress.ui.dxDateBox.getInstance(toBox);
  toInst.options.value = new Date(2026, 10, 14);

  // Angular / DevExtreme blur model reversion simulation:
  // If input was modified by keystrokes but dxDateBox model was not committed, revert on blur/search!
  fromInput.addEventListener('blur', () => {
    if (!fromBox.__committed) {
      // Revert to widget model
      const d = fromInst.options.value;
      fromInput.value = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
  });
  toInput.addEventListener('blur', () => {
    if (!toBox.__committed) {
      const d = toInst.options.value;
      toInput.value = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    }
  });

  // Buttons on form
  const btnSearch = doc.createElement('dx-button');
  btnSearch.setAttribute('icon', 'search');
  btnSearch.className = 'btn-search';
  const spanSearch = doc.createElement('span');
  spanSearch.className = 'dx-button-text';
  spanSearch.textContent = 'Search';
  btnSearch.appendChild(spanSearch);

  // Blue form button (Decoy from Hình 2)
  const btnFormExcel = doc.createElement('dx-button');
  btnFormExcel.className = 'dx-button dx-button-mode-contained dx-button-default btn-form-excel';
  const spanFormExcel = doc.createElement('span');
  spanFormExcel.className = 'dx-button-text';
  spanFormExcel.textContent = 'Excel';
  btnFormExcel.appendChild(spanFormExcel);

  btnFormExcel.addEventListener('click', () => {
    win.__buttonClicked = 'BLUE_FORM_EXCEL_BUTTON';
    win.__blueBtnClicks = (win.__blueBtnClicks || 0) + 1;
  });

  filterForm.appendChild(fromBox);
  filterForm.appendChild(toBox);
  filterForm.appendChild(btnSearch);
  filterForm.appendChild(btnFormExcel);
  doc.body.appendChild(filterForm);

  // DataGrid Container & Toolbar (Hình 3)
  const gridContainer = doc.createElement('div');
  gridContainer.className = 'dx-datagrid dx-widget';

  const headerPanel = doc.createElement('div');
  headerPanel.className = 'dx-datagrid-header-panel';
  const toolbar = doc.createElement('div');
  toolbar.className = 'dx-toolbar';

  // Decoy square button (Column Chooser)
  const btnColumnChooser = doc.createElement('div');
  btnColumnChooser.className = 'dx-button dx-datagrid-column-chooser-button';
  btnColumnChooser.setAttribute('title', 'Column Chooser');
  toolbar.appendChild(btnColumnChooser);

  // Target Square Excel export button (Hình 3)
  const btnSquareExport = doc.createElement('div');
  btnSquareExport.className = 'dx-datagrid-export-button dx-button dx-button-normal dx-widget dx-button-has-icon';
  btnSquareExport.setAttribute('title', 'Export all data to Excel');
  btnSquareExport.setAttribute('aria-label', 'Export all data to Excel');
  const btnContent = doc.createElement('div');
  btnContent.className = 'dx-button-content';
  const iconXlsx = doc.createElement('i');
  iconXlsx.className = 'dx-icon dx-icon-export-excel-button dx-icon-xlsxfile';
  btnContent.appendChild(iconXlsx);
  btnSquareExport.appendChild(btnContent);
  toolbar.appendChild(btnSquareExport);

  btnSquareExport.addEventListener('click', () => {
    win.__buttonClicked = 'SQUARE_GRID_EXPORT_BUTTON';
    win.__squareBtnClicks = (win.__squareBtnClicks || 0) + 1;

    // Trigger Excel Blob generation
    const mockBlob = new win.Blob(['MOCK_EXCEL_XLSX_BINARY_BUFFER_OVER_500_BYTES_FOR_SALES_REPORT_DATA_TRANSACTION_TESTING_DATA_STREAM_SIMULATION'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    win.URL.createObjectURL(mockBlob);
  });

  headerPanel.appendChild(toolbar);
  gridContainer.appendChild(headerPanel);

  // DataGrid rows view
  const rowsView = doc.createElement('div');
  rowsView.className = 'dx-datagrid-rowsview';
  const table = doc.createElement('table');
  const tbody = doc.createElement('tbody');
  table.appendChild(tbody);
  rowsView.appendChild(table);
  gridContainer.appendChild(rowsView);

  // Populate initial rows if requested
  const rowCount = options.initialRows ?? 5;
  for (let i = 0; i < rowCount; i++) {
    const tr = doc.createElement('tr');
    tr.className = 'dx-data-row';
    const tdStore = doc.createElement('td');
    tdStore.className = 'cell-storeId';
    tdStore.textContent = 'TM01';
    const tdTotal = doc.createElement('td');
    tdTotal.textContent = '1,500,000';
    tr.appendChild(tdStore);
    tr.appendChild(tdTotal);
    tbody.appendChild(tr);
  }

  btnSearch.addEventListener('click', () => {
    win.__searchClicks = (win.__searchClicks || 0) + 1;
    // Check if models reverted
    win.__searchPayload = {
      from: fromInput.value,
      to: toInput.value,
    };
  });

  doc.body.appendChild(gridContainer);

  return { doc, win, fromBox, toBox, fromInput, toInput, btnSearch, btnFormExcel, btnSquareExport, tbody };
}

export function createMockPOSInventoryDocument(options = {}) {
  const doc = new MockDocument();
  const win = new MockWindow(doc);

  // Search button
  const btnSearch = doc.createElement('dx-button');
  btnSearch.setAttribute('icon', 'search');
  btnSearch.className = 'btn-search';
  const spanSearch = doc.createElement('span');
  spanSearch.className = 'dx-button-text';
  spanSearch.textContent = 'Search';
  btnSearch.appendChild(spanSearch);

  // Loading wave overlay (equalizer animation from Hình 4)
  const loadingWave = doc.createElement('div');
  loadingWave.className = 'dx-loadpanel loading-wave';
  const indicator = doc.createElement('div');
  indicator.className = 'dx-loadindicator-wrapper';
  loadingWave.appendChild(indicator);
  if (!options.waveActive) {
    loadingWave.style.display = 'none';
  }

  // DataGrid
  const gridContainer = doc.createElement('div');
  gridContainer.className = 'dx-datagrid dx-widget';
  if (win.DevExpress?.ui?.dxDataGrid?.getInstance) {
    win.DevExpress.ui.dxDataGrid.getInstance(gridContainer);
  }

  // Toolbar with square export button
  const headerPanel = doc.createElement('div');
  headerPanel.className = 'dx-datagrid-header-panel';
  const toolbar = doc.createElement('div');
  toolbar.className = 'dx-toolbar';
  const btnSquareExport = doc.createElement('div');
  btnSquareExport.className = 'dx-datagrid-export-button dx-button dx-button-normal dx-widget dx-button-has-icon';
  const iconXlsx = doc.createElement('i');
  iconXlsx.className = 'dx-icon dx-icon-xlsxfile';
  btnSquareExport.appendChild(iconXlsx);
  toolbar.appendChild(btnSquareExport);
  headerPanel.appendChild(toolbar);
  gridContainer.appendChild(headerPanel);

  // Header row with Sloc Id and Item Code filters (Hình 5)
  const headersView = doc.createElement('div');
  headersView.className = 'dx-datagrid-headers';
  const headerTable = doc.createElement('table');
  const headerTr = doc.createElement('tr');
  headerTr.className = 'dx-header-row';

  // Sloc Id column
  const thSloc = doc.createElement('td');
  thSloc.textContent = 'Sloc Id';
  const filterIconSloc = doc.createElement('span');
  filterIconSloc.className = 'dx-header-filter dx-header-filter-empty';
  thSloc.appendChild(filterIconSloc);
  headerTr.appendChild(thSloc);

  // Item Code column
  const thItem = doc.createElement('td');
  thItem.textContent = 'Item Code';
  const filterIconItem = doc.createElement('span');
  filterIconItem.className = 'dx-header-filter dx-header-filter-empty';
  thItem.appendChild(filterIconItem);
  headerTr.appendChild(thItem);

  headerTable.appendChild(headerTr);
  headersView.appendChild(headerTable);
  gridContainer.appendChild(headersView);

  // Rows view
  const rowsView = doc.createElement('div');
  rowsView.className = 'dx-datagrid-rowsview';
  const dataTable = doc.createElement('table');
  const tbody = doc.createElement('tbody');
  dataTable.appendChild(tbody);
  rowsView.appendChild(dataTable);

  // No data banner
  const noData = doc.createElement('div');
  noData.className = 'dx-datagrid-nodata';
  noData.textContent = 'No data';
  noData.style.display = options.initialRows > 0 ? 'none' : '';
  rowsView.appendChild(noData);
  gridContainer.appendChild(rowsView);

  // Add initial rows
  const initialCount = options.initialRows ?? 0;
  for (let i = 0; i < initialCount; i++) {
    const tr = doc.createElement('tr');
    tr.className = 'dx-data-row';

    const tdSloc = doc.createElement('td');
    tdSloc.className = 'cell-slocId';
    tdSloc.setAttribute('data-field', 'slocId');
    tdSloc.textContent = i % 2 === 0 ? 'SDC0101' : 'SDC0102';

    const tdItem = doc.createElement('td');
    tdItem.className = 'cell-itemCode';
    tdItem.setAttribute('data-field', 'itemCode');
    tdItem.textContent = `ITEM-00${i + 1}`;

    tr.appendChild(tdSloc);
    tr.appendChild(tdItem);
    tbody.appendChild(tr);
  }

  // Header filter popup menu (Hình 5)
  const popupContent = doc.createElement('div');
  popupContent.className = 'dx-header-filter-menu dx-popup-content';
  popupContent.style.display = 'none';

  const searchInput = doc.createElement('input');
  searchInput.className = 'dx-texteditor-input';
  searchInput.setAttribute('placeholder', 'Search');
  popupContent.appendChild(searchInput);

  const listContainer = doc.createElement('div');
  listContainer.className = 'dx-list-items';

  const slocCheck1 = doc.createElement('div');
  slocCheck1.className = 'dx-list-item';
  const chk1 = doc.createElement('input');
  chk1.setAttribute('type', 'checkbox');
  chk1.value = 'SDC0101';
  const lbl1 = doc.createElement('span');
  lbl1.textContent = 'SDC0101';
  slocCheck1.appendChild(chk1);
  slocCheck1.appendChild(lbl1);
  listContainer.appendChild(slocCheck1);

  const slocCheck2 = doc.createElement('div');
  slocCheck2.className = 'dx-list-item';
  const chk2 = doc.createElement('input');
  chk2.setAttribute('type', 'checkbox');
  chk2.value = 'SDC0102';
  const lbl2 = doc.createElement('span');
  lbl2.textContent = 'SDC0102';
  slocCheck2.appendChild(chk2);
  slocCheck2.appendChild(lbl2);
  listContainer.appendChild(slocCheck2);

  popupContent.appendChild(listContainer);

  const btnOk = doc.createElement('dx-button');
  btnOk.className = 'dx-button dx-button-default';
  const spanOk = doc.createElement('span');
  spanOk.className = 'dx-button-text';
  spanOk.textContent = 'OK';
  btnOk.appendChild(spanOk);
  popupContent.appendChild(btnOk);

  const btnCancel = doc.createElement('dx-button');
  btnCancel.className = 'dx-button dx-button-normal';
  const spanCancel = doc.createElement('span');
  spanCancel.className = 'dx-button-text';
  spanCancel.textContent = 'Cancel';
  btnCancel.appendChild(spanCancel);
  popupContent.appendChild(btnCancel);

  filterIconSloc.addEventListener('click', () => {
    popupContent.style.display = '';
  });

  btnOk.addEventListener('click', () => {
    popupContent.style.display = 'none';
    const checkedValues = [];
    if (chk1.checked) checkedValues.push('SDC0101');
    if (chk2.checked) checkedValues.push('SDC0102');
    const gridInst = gridContainer.__dxInstance || win.DevExpress?.ui?.dxDataGrid?.getInstance?.(gridContainer);
    if (gridInst && typeof gridInst.columnOption === 'function') {
      gridInst.columnOption('slocId', 'filterValues', checkedValues);
      gridInst.columnOption('slocId', 'filterType', 'include');
    }
  });

  btnCancel.addEventListener('click', () => {
    popupContent.style.display = 'none';
  });

  btnSquareExport.addEventListener('click', () => {
    win.__buttonClicked = 'SQUARE_GRID_EXPORT_BUTTON';
    const blob = new win.Blob(['MOCK_INVENTORY_XLSX_STREAM_OVER_500_BYTES_CONTAINING_DATA_ROWS'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    win.URL.createObjectURL(blob);
  });

  btnSearch.addEventListener('click', () => {
    win.__searchClicks = (win.__searchClicks || 0) + 1;
    win.__clickTimestamps.push(Date.now());
    if (options.populateOnSearchClick) {
      // Add data rows
      tbody.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const tr = doc.createElement('tr');
        tr.className = 'dx-data-row';
        const tdSloc = doc.createElement('td');
        tdSloc.className = 'cell-slocId';
        tdSloc.setAttribute('data-field', 'slocId');
        tdSloc.textContent = 'SDC0101';
        const tdItem = doc.createElement('td');
        tdItem.className = 'cell-itemCode';
        tdItem.setAttribute('data-field', 'itemCode');
        tdItem.textContent = `ITEM-00${i + 1}`;
        tr.appendChild(tdSloc);
        tr.appendChild(tdItem);
        tbody.appendChild(tr);
      }
      noData.style.display = 'none';
    }
  });

  doc.body.appendChild(btnSearch);
  doc.body.appendChild(loadingWave);
  doc.body.appendChild(gridContainer);
  doc.body.appendChild(popupContent);

  return {
    doc,
    win,
    btnSearch,
    loadingWave,
    gridContainer,
    tbody,
    noData,
    filterIconSloc,
    popupContent,
    searchInput,
    chk1,
    chk2,
    btnOk,
    btnCancel,
    btnSquareExport,
  };
}
