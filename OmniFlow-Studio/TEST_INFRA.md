# FM-AUTO-OPS E2E Test Infrastructure (`TEST_INFRA.md`)

## 1. Mission & Philosophy
The E2E Test Suite provides automated, opaque-box verification of FM-AUTO-OPS automation flows, adapters, security subsystems, and deployment pipelines. All tests execute deterministically without external network connectivity, third-party test framework bloat, or fragile live-server dependencies.

### Core Architecture Principles
1. **Opaque-Box & Decoupled**: Tests interact strictly through public interfaces (Playwright `Page` / DOM APIs, adapter methods, IPC contracts, configuration files, and filesystem artifacts). No internal private method hacking.
2. **Deterministic & Network-Independent**: Tests use only reserved `.test` hostnames and in-memory browser pages; production ERP/POS endpoints are never contacted. All tests run reliably in CI and offline developer environments via high-fidelity in-memory simulated DOM, Playwright mock harnesses, and cryptographic oracles.
3. **Zero External Test Runner Dependencies**: Leverages the Node.js native test runner (`node:test` and `node:assert/strict`) built directly into Node.js (Node >= 20.0.0, Node v24.21.0 active in workspace). Zero installation overhead; executes with native ESM speed.
4. **Multi-Tier Quality Guarantee**:
   - **Tier 1 (Feature Coverage)**: 42 test cases (6 per feature across 7 features) verifying happy path and functional baselines.
   - **Tier 2 (Boundary & Corner Cases)**: 42 test cases (6 per feature across 7 features) verifying error handling, race conditions, timeouts, and edge cases.
   - **Tier 3 (Cross-Feature Pairwise Integrations)**: 8 test cases verifying pairwise contract handoffs across multiple adapters.
   - **Tier 4 (Real-World Application Scenarios)**: 6 test cases verifying complete end-to-end procurement workflows, failover, and operational resilience.
   - **Total Test Cases**: **98 test cases** (exceeding the >= 82 test case requirement).

---

## 2. Directory Layout
```
tests/e2e/
├── harness/
│   ├── mock-dom.mjs             # In-memory DOM tree & DevExtreme / SAP SLD element simulation
│   ├── mock-page.mjs            # Playwright Page, Locator, and Event mock engine
│   ├── mock-browser-engine.mjs  # BrowserManager mock returning isolated Page profiles
│   ├── mock-security.mjs        # AES-256-GCM cipher test oracle & LogRedactor validator
│   └── mock-release.mjs         # Electron packaging & GitHub Actions workflow validator
├── r1-sap-sld-logon.test.mjs              # R1 SAP SLD logon automation (12 tests)
├── r2-pos-date-range.test.mjs            # R2 POS date range setter & download (12 tests)
├── r3-pos-excel-export.test.mjs          # R3 POS square xlsx button & blob hook (12 tests)
├── r4-inventory-search-retry.test.mjs    # R4 Inventory loading wave & 3s retry (12 tests)
├── r5-devexpress-grid-filter.test.mjs    # R5 DevExpress grid filtering (Sloc/Item) (12 tests)
├── r6-security-hardening.test.mjs        # R6 AES-256-GCM storage, IPC & log redaction (12 tests)
├── r7-github-distribution.test.mjs       # R7 Electron builder & GitHub CI/CD pipeline (12 tests)
└── r8-cross-feature-integration.test.mjs # Tiers 3 & 4 Cross-feature & real scenarios (14 tests)
```

---

## 3. Test Runner Conventions
- **Command**: `node --test tests/e2e/*.test.mjs`
- **Single Suite Command**: `node --test tests/e2e/<suite-name>.test.mjs`
- **Prerequisites**: Node.js >= 20.0.0 (Node v24.21.0 recommended)
- **Module System**: Pure ECMAScript Modules (`.mjs`)
- **Assertions**: `node:assert/strict`
- **Output Reporters**: Default spec reporter (`node --test`), TAP (`node --test --test-reporter=tap`), or dot (`node --test --test-reporter=dot`)

---

## 4. Mock Harness Specification

### 4.1 `mock-dom.mjs`
Simulates DOM nodes, forms, custom widgets, and DevExtreme components:
- `MockElement`: Represents HTML nodes (`select`, `input`, `button`, `div`, `table`, etc.).
  - Properties: `id`, `className`, `classList`, `value`, `selectedIndex`, `options`, `checked`, `disabled`, `style.display`, `textContent`, `innerText`, `children`, `parentNode`.
  - Methods: `querySelector`, `querySelectorAll`, `getAttribute`, `setAttribute`, `removeAttribute`, `addEventListener`, `removeEventListener`, `dispatchEvent`, `click`, `focus`, `blur`.
  - DevExtreme extensions:
    - `window.DevExpress.ui.dxDateBox.getInstance(el)`: Manages `.option(name, val)` and `.option(name)` with auto-sync to inner input element and change detection.
    - `window.DevExpress.ui.dxDataGrid.getInstance(el)`: Manages `.columnOption(field, option, val)` and `.columnOption(field, option)` with row filtering capability.
- `MockDocument`: Container with `getElementById`, `querySelector`, `querySelectorAll`, `createElement`, `body`, `head`.
- `MockWindow`: Container with `document`, `location`, `DevExpress`, `URL`, `Blob`, `FileReader`, `Event`, `CustomEvent`.

### 4.2 `mock-page.mjs`
Implements the high-fidelity subset of the Playwright `Page` and `Locator` interface required by `@fm/sap-adapter`, `@fm/pos-adapter`, and `@fm/workflow-engine`:
- `locator(selector)`: Returns `MockLocator` supporting:
  - `.count()`
  - `.first()`, `.last()`, `.nth(index)`
  - `.isVisible()`, `.isEnabled()`, `.isChecked()`
  - `.fill(value)`
  - `.click(options)`
  - `.inputValue()`
  - `.selectOption(values)`
  - `.waitFor(options)`
  - `.filter({ hasText, has })`
- `goto(url, options)`: Updates `page.url()`, resets or preserves page state, and triggers navigation hooks.
- `evaluate(fn, ...args)`: Executes function in a sandbox with `window`, `document`, and browser globals bound to `MockDocument`.
- `waitForSelector(selector, options)`: Polls or immediately resolves when selector matches DOM elements.
- `waitForTimeout(ms)`: Simulates time advance without excessive real-time delays.
- `waitForResponse(predicate, options)`: Matches pending or configured mock network responses.
- `waitForEvent('download', options)`: Emits synthetic `Download` object with `.suggestedFilename()` and `.saveAs()`.
- `keyboard`: Implements `.press(key)` and `.type(text, options)`.

### 4.3 `mock-browser-engine.mjs`
Implements the `BrowserManager` interface:
- `getPage('SAP')`: Returns dedicated SAP `MockPage`.
- `getPage('POS')`: Returns dedicated POS `MockPage`.
- `getPage(profile)`: Returns isolated `MockPage` for any profile.
- `reset()`: Resets all mock pages, network interceptors, and cookies to clean initial state.
- `close()`: Closes all active mock pages.

### 4.4 `mock-security.mjs`
Provides cryptographic oracle, AES-256-GCM verification, and log redaction validation:
- `verifyAES256GCM(ciphertextFormatted, passwordKey)`: Verifies format (`IV:AuthTag:Ciphertext`), decrypts, and checks authentication tag integrity.
- `createAES256GCMPayload(plaintext, passwordKey)`: Helper generating valid AES-256-GCM payloads for testing.
- `simulateLogRedactor(redactorFn, rawPayload)`: Feeds sensitive strings and asserts zero plaintext leakages.
- `tamperCiphertext(ciphertextFormatted)`: Flips 1 bit to test authentication tag rejection.

### 4.5 `mock-release.mjs`
Validates packaging and CI/CD artifacts:
- `validatePackageJson(pkgPath)`: Asserts `build.win.target` contains `"nsis"` and `"zip"`, and `build.extraResources` contains `"apps/web/dist"`.
- `validateWorkflowYaml(yamlPath)`: Asserts trigger on `push.tags: ['v*.*.*']`, runner `windows-latest`, build steps, and asset release action.
- `validateInstallerArtifacts(distDir)`: Asserts generated `.exe` and `.zip` files match expected distribution formats.

---

## 5. Complete Test Suite Inventory (98 Tests)

| Test Suite File | Requirement Scope | Tier 1 (Happy Path) | Tier 2 (Boundary/Edge) | Tier 3 (Integration) | Tier 4 (Real Scenarios) | Total |
|---|---|:---:|:---:|:---:|:---:|:---:|
| `tests/e2e/r1-sap-sld-logon.test.mjs` | R1: SAP SLD Logon Automation | 6 | 6 | - | - | 12 |
| `tests/e2e/r2-pos-date-range.test.mjs` | R2: POS Date Range & Download | 6 | 6 | - | - | 12 |
| `tests/e2e/r3-pos-excel-export.test.mjs` | R3: POS Excel Export Button | 6 | 6 | - | - | 12 |
| `tests/e2e/r4-inventory-search-retry.test.mjs` | R4: Inventory Wait & Search Retry | 6 | 6 | - | - | 12 |
| `tests/e2e/r5-devexpress-grid-filter.test.mjs` | R5: DevExpress Grid Filter | 6 | 6 | - | - | 12 |
| `tests/e2e/r6-security-hardening.test.mjs` | R6: Advanced Security Hardening | 6 | 6 | - | - | 12 |
| `tests/e2e/r7-github-distribution.test.mjs` | R7: GitHub Distribution & Packaging | 6 | 6 | - | - | 12 |
| `tests/e2e/r8-cross-feature-integration.test.mjs` | Tiers 3 & 4 Cross-Feature Workflows | - | - | 8 | 6 | 14 |
| **Total** | | **42** | **42** | **8** | **6** | **98** |

---

## 6. Execution Commands & Verification
```powershell
# Run all E2E test suites
node --test tests/e2e/*.test.mjs

# Run individual suites
node --test tests/e2e/r1-sap-sld-logon.test.mjs
node --test tests/e2e/r2-pos-date-range.test.mjs
node --test tests/e2e/r3-pos-excel-export.test.mjs
node --test tests/e2e/r4-inventory-search-retry.test.mjs
node --test tests/e2e/r5-devexpress-grid-filter.test.mjs
node --test tests/e2e/r6-security-hardening.test.mjs
node --test tests/e2e/r7-github-distribution.test.mjs
node --test tests/e2e/r8-cross-feature-integration.test.mjs
```
