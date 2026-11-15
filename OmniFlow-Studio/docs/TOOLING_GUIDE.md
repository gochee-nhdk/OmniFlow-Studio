# FM-AUTO-OPS Tooling & Agent Skill Ecosystem Guide

## 1. Overview & Architecture

To accelerate the delivery of production-grade automation, prevent premature over-engineering, and enforce rigorous engineering practices across FM-AUTO-OPS, five external developer toolkits, CLI frameworks, and agent skill ecosystems have been integrated into the project:

| Tool | Upstream Repository | Purpose in FM-AUTO-OPS | Location |
|------|---------------------|------------------------|----------|
| **ECC** | `affaan-m/ECC` | Universal multi-agent control plane, doctor diagnostic, and security scanning | `tools/ecc` |
| **Graphify** | `Graphify-Labs/graphify` | AST knowledge graph extractor and structural dependency intelligence | `tools/graphify` |
| **Ponytail** | `DietrichGebert/ponytail` | Lazy senior developer philosophy, minimal-diff enforcement, and anti-bloat auditing | `tools/ponytail` |
| **Spec-Kit** | `github/spec-kit` | Spec-Driven Development (SDD) CLI and structured specification templates | `tools/spec-kit` |
| **Matt Pocock Skills** | `mattpocock/skills` | High-impact engineering & productivity agent skills (TDD, bug diagnosis, review) | `tools/mattpocock-skills` |

### Monorepo Isolation Strategy
To maintain absolute stability in FM-AUTO-OPS:
1. **Isolated from Workspace Resolution**: `tools/` is intentionally **excluded** from `FM-AUTO-OPS/pnpm-workspace.yaml`. Turborepo (`turbo.json`) and `pnpm install` operate exclusively on `apps/*`, `packages/*`, and `services/*`.
2. **Clean Vendoring**: External repositories are shallow-cloned, nested `.git` folders are stripped to avoid Git submodule gitlinks (`mode 160000`), and nested `.github/workflows` are removed to prevent CI pipeline contamination. Upstream URLs and commit SHAs are tracked in `tools/manifest.json`.
3. **Runtime Protection**: `.gitignore` strictly excludes `tools/**/node_modules/`, `tools/**/.venv/`, and `tools/**/__pycache__/`.

---

## 2. Developer & CI Command Reference

All integrated tools can be executed directly from `FM-AUTO-OPS` using `pnpm` scripts:

### Setup & Synchronization
```bash
# Clone/vendor repositories, generate manifest.json, set up environments, and deploy skills
pnpm run tools:setup
```

### ECC (Enterprise Cursor Control)
```bash
# General CLI help and status
pnpm run ecc
pnpm run ecc:status

# System health and harness diagnostics
pnpm run ecc:doctor

# Agent prompt and tool catalog
pnpm run ecc:catalog
```

### Graphify (Codebase Knowledge Graph)
```bash
# CLI help
pnpm run graphify -- --help

# Generate or update graph for FM-AUTO-OPS
pnpm run graphify:update

# Query dependencies between components
pnpm run graphify:query -- <query>

# Export interactive HTML graph visualization
pnpm run graphify:export
```

### Spec-Kit (Spec-Driven Development)
```bash
# CLI help
pnpm run specify --help
pnpm run spec-kit -- --help

# Verify specification conformance
pnpm run spec-kit:check
```

### Ponytail (Lazy Senior Dev Mode)
```bash
# View active mode and core guidelines
pnpm run ponytail

# Set active mode (lite | full | ultra | off)
pnpm run ponytail full

# Run whole-codebase simplicity & bloat audit
pnpm run ponytail:audit

# Review current uncommitted git changes against minimal-diff principles
pnpm run ponytail:review
```

---

## 3. Agent Skills Integration (`.agents/skills/`)

Core agent skills from Matt Pocock's repository and Ponytail are deployed to `FM-AUTO-OPS/.agents/skills/` for direct consumption by AI agents (Antigravity, Cursor, Codex, Claude Code).

### Deployed Skills Inventory

| Skill Name | Directory | Primary Role |
|------------|-----------|--------------|
| `tdd` | `.agents/skills/tdd` | Test-driven development loop: write failing test at public seam, make it pass, refactor |
| `diagnosing-bugs` | `.agents/skills/diagnosing-bugs` | Systematic bug isolation: reproduce, hypothesize, isolate root cause before editing |
| `code-review` | `.agents/skills/code-review` | Rigorous pre-merge gate: correctness, edge cases, data safety, load performance |
| `domain-modeling` | `.agents/skills/domain-modeling` | Boundary and state machine design (invariants, valid state transitions) |
| `implement-spec` | `.agents/skills/implement-spec` | Spec-driven code implementation adhering strictly to task criteria |
| `ponytail` | `.agents/skills/ponytail` | Lazy senior dev mode: shortest working diff, YAGNI, standard library reuse |
| `ponytail-review` | `.agents/skills/ponytail-review` | Anti-overengineering review: rejects unnecessary wrappers and speculative abstractions |
| `ponytail-audit` | `.agents/skills/ponytail-audit` | Complexity audit: flags bloat, dependency creep, and unneeded complexity |

---

## 4. Application to FM-AUTO-OPS Development Milestones

These tools directly support the ongoing production hardening and automation fixes across the application:

### Milestone M2 — SAP SLD Logon Automation (R1)
- **Activate**: `/diagnosing-bugs` and `/ponytail`
- **Application**:
  - Reproduce the logon dropdown option reset issue (`#sbo_company`, `#sbo_user`, `#sbo_password`).
  - Follow the smallest effective diff principle: wait for async OData option population and avoid adding complex retry wrappers where standard Playwright state settlement solves the root cause.

### Milestone M3 — POS Automation Suite (R2, R3, R4, R5)
- **Activate**: `/tdd` and `/implement-spec`
- **Application**:
  - Date Range Reset (R2): Use TDD to ensure date inputs correctly map `fromDate` and `toDate` without resetting to today's date.
  - Excel Export Button (R3): Target the square `.dx-datagrid-export-button` directly.
  - Inventory Search Wait & Retry (R4): Add state-based assertions: 0 search clicks if data already rendered after loading wave ends; 3-second wait before retrying search if empty.
  - DevExpress Grid Filters (R5): Verify filtering at public API and DOM header filter popup seams.

### Milestone M4 — Production Security Hardening (R6)
- **Activate**: `pnpm run ecc` (security checks) and `/code-review`
- **Application**:
  - Verify that `SecureStorage` (AES-256-GCM / DPAPI) has zero plaintext fallbacks.
  - Verify that `LogRedactor` sanitizes all credentials across IPC handlers, Electron main logger, and SQLite sinks.

### Milestone M5 — GitHub Release CI/CD (R7)
- **Activate**: `pnpm run ponytail:audit` and `pnpm run spec-kit:check`
- **Application**:
  - Ensure release packaging (NSIS, portable ZIP) contains only necessary assets (`apps/web/dist`, Launcher executable).
  - Verify `.github/workflows/release.yml` produces downloadable release assets.

---

## 5. Maintenance & Tool Upgrades

To refresh vendored tools with latest upstream revisions:
1. Re-run `node scripts/setup-tools.mjs`.
2. Inspect changes with `pnpm run ponytail:review`.
3. Verify that monorepo builds and tests pass: `pnpm test`, `pnpm typecheck`, `pnpm build`.
4. Commit updated `tools/manifest.json` and tool assets.
