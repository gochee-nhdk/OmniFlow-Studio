# FM AUTO OPS
## ENTERPRISE PROCUREMENT & BUSINESS PROCESS AUTOMATION PLATFORM
### ONE CLICK. COMPLETE AUTOMATION.

FM AUTO OPS is an enterprise robotic process automation (RPA) platform designed for daily Purchasing, Inventory, and Supply Chain workflows.

---

## 1. System Overview

```
                               ┌────────────────────────────────┐
                               │       FM AUTO OPS CLOUD        │
                               │   (Web Dashboard & Monitoring) │
                               └───────────────┬────────────────┘
                                               │ WSS (outbound only)
                                               │ Short-lived Device JWT
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       WINDOWS LOCAL RPA AGENT                               │
│                      (d:\tool auto\FM-AUTO-OPS)                             │
├──────────────────────────────┬──────────────────────────────┬───────────────┤
│    Browser Automation Engine │   Windows Credential Vault   │ Local SQLite  │
│    (Isolated Chromium)       │   (keytar / DPAPI)           │ Database      │
└──────────────┬───────────────┴──────────────┬───────────────┴───────────────┘
               │                              │
               ▼                              ▼
     [ POS RPFO System ]            [ SAP Business One ]
      http://172.16.1.200/           https://172.16.1.210:8100/
      - Inventory Onhand             - Session Recovery
      - Sales Transaction Detail     - Purchasing - A/P
```

---

## 2. Directory Architecture

All operational procurement files are organized automatically in:

```
D:\FM_AUTO_OPS\
├── Inventory\      # Inventory Onhand Excel files (Inventory_YYYY-MM-DD.xlsx)
├── Sales\          # Sales Transaction Detail workbooks (Sales_FROM_TO.xlsx)
├── SAP\            # SAP Business One exports
├── PO\             # Purchase Order drafts and records
├── Return\         # Return summaries and vendor forms
├── Archive\        # Historical and versioned backups
├── Error\          # Quarantined or damaged files
├── Logs\           # Local audit logs and diagnostic traces
└── Temp\           # Playwright in-flight download buffer
```

---

## 3. Verified Environmental Status (2026-11-13)

| Target | Address | Protocol | Network Test | UI Discovery Status |
| :--- | :--- | :--- | :--- | :--- |
| **POS RPFO** | `172.16.1.200` | HTTP :80 | **REACHABLE (Verified)** | Dashboard, More Menu, Report Submenu, Inventory, Sales |
| **SAP Business One** | `172.16.1.210` | HTTPS :8100 | **REACHABLE (Verified)** | Authenticated dashboard confirmed; login form undiscovered |
| **Storage Vault** | `D:\FM_AUTO_OPS` | Local NTFS | **VERIFIED & CREATED** | 9 directories ready, write permissions passed |

---

## 4. Key Workflows

### Primary Action: RUN DAILY PROCUREMENT
- One-click trigger from Dashboard
- Authenticates into POS & SAP using local Windows OS Credentials
- Downloads **Sales Transaction Detail** (date range: configured period)
- Discovers and triggers **Inventory Onhand** export
- Validates Excel workbook integrity (size > 1KB, worksheet check, headers, row count)
- Applies versioned naming (e.g. `_v2`) to eliminate silent overwriting
- Routes files to `D:\FM_AUTO_OPS\Sales\` and `D:\FM_AUTO_OPS\Inventory\`
- Persists run metadata and error telemetry to local SQLite

---

## 5. Security & Safety Principles

1. **Zero Cloud Credential Storage:** Passwords reside exclusively in the Windows Credential Manager.
2. **Never Auto-Confirm Concurrent SAP Logins:** When SAP prompts that another session is active with the same user code, the system immediately **PAUSES** and requires explicit human approval.
3. **No Arbitrary Remote Shells:** Only predefined, schema-validated RPA commands are processed.
4. **Local-First Resiliency:** The platform operates with full autonomy even when disconnected from cloud services.

---

## 6. Development & Run Commands

```bash
# Setup directories & verify write access
node scripts/setup.mjs

# Launch Web Dashboard (Vite + React)
pnpm web:dev

# Launch Windows Local Agent (Electron)
pnpm agent:dev
```
