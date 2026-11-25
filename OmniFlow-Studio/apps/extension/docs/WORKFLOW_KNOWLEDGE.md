# POS and SAP workflow knowledge

Runtime source: `src/engines/workflow-knowledge.ts`.

Evidence: user-provided `THAO TÁC PHẦN MỀM SAP_POS.pdf` (26 pages). This page maps the instructions and screenshots into named workflows. The PDF guides navigation and export; each automation still has to inspect the live application state.

## POS

### Login and outlet

1. Open `http://172.16.1.200/home`.
2. Enter the configured username and password and log in.
3. Wait for the store list, select `FM04 - Hoàng Hoa Thám`, and wait for the dashboard.
4. Open `More` → `Report`.

### Inventory Onhand

1. Open `Inventory Onhand` and run `Search`.
2. Wait until inventory rows load.
3. Filter `Sloc Id` to exactly:
   `SDC0101`, `SFF0101`, `SFM0101`, `SFM0201`, `SFM0301`, `SFM0401`,
   `SFM0501`, `SFM06QT1`, `SFM07AP1`, `SFM0801`, `SFM0901`, `SFM1001`.
4. Export Excel and verify the download completes.

Source pages: 12–21. The runtime passes the outlet and SLOC list explicitly so edited extension settings cannot silently change this SOP.

### Sales Transaction Detail

1. Open `Sales Transaction Detail`.
2. Select the prior week, run `Search`, and wait for the result grid.
3. Export Excel and verify the download completes.

Source pages: 12–18 and 22–25. The PDF says “tuần trước” but does not define the week boundary or show a completed end-date selection. Runtime currently interprets this as the previous complete Monday–Sunday period. Confirm or change that convention if POS reporting uses another calendar.

## SAP Business One

### Logon

1. Open `https://172.16.1.210:8100/dispatcher/`.
2. Select company `Công ty TNHH Thương Mại LARIA (FM_PRO)`.
3. Enter the configured user ID and password and choose `Log on`.
4. If the logon flow returns an error, the guide recommends reopening the dispatcher in a new tab.

### Pricelist export

1. Open the list/query area shown in the guide and open `Danh Mục`.
2. Find and open `Danh sach item ncc pricelist_non_Asset`.
3. Choose the export control shown in the guide, select `.xlsx`, and confirm each `OK` prompt.
4. Verify the download completes.

Source pages: 1–11. The control in the PDF is identified by screenshot arrows rather than a stable text label, so runtime must use the SAP engine’s page recognition and live visible controls; never reuse screenshot coordinates.

### Purchase Order and Goods Return

The guide points to `Purchasing - A/P` → `Purchase Order` or `Goods Return`. The runtime may navigate to these forms, then pauses for a human to inspect the document. Creating, saving, posting, or submitting a financial/inventory document is outside the guide’s authorization.

Source pages: 3–4.

## Agent execution rules

- The Agent tab uses visible accessible DOM labels for page grounding. It captures a screenshot for the user to review, but the screenshot is not sent to an OCR or vision model.
- A plan must be explicitly approved before an action starts.
- Generic page actions require one unique matching label and re-check the label before execution. Password, hidden, and file inputs cannot be read or filled.
- Buttons that appear to send, delete, pay, purchase, order, confirm, or save are blocked by the generic agent. SAP purchase and return routines only navigate to the form.
- POS and SAP routines delegate to the existing specialized engines, which perform their own page-state checks and download handling.
- Pages blocked by browser access rules, unlabeled controls, canvas-only screens, or authentication challenges need specialized integration; the Agent must report that it cannot inspect them.
