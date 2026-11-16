# OmniFlow Studio contributor instructions

## Architecture

- This is a pnpm/Turbo monorepo. `apps/web` is the React operator UI, `apps/local-agent` owns Electron IPC and SQLite settings, and `packages/*-adapter` contains browser automation integrations.
- User selections and automation preferences must be persisted through `settings:set` and read from SQLite by workflow entry points. Keep UI and backend option names aligned.
- `BrowserManager` owns task references for the POS and SAP tabs. Prefer attaching to an explicitly available local CDP endpoint and create/reuse task tabs without closing unrelated tabs. Stop and application shutdown must preserve visible tabs; only isolated headless test contexts may be closed automatically.
- POS exports require UI grid filtering and a second ExcelJS row filter before a downloaded workbook is returned. If a requested filter cannot be verified from the workbook headers, fail the export instead of returning unverified data.
- Keep the React operator UI lightweight. Avoid duplicate polling, and do not run background network or status polling while an automation workflow is active.

## Validation

- Build with `pnpm run build` from this directory.
- Run `pnpm run test:all` before reporting completion. Do not skip core browser, POS, SAP, or security coverage when a local isolated test can exercise it.
- Keep browser tests isolated from a user's existing browser profile and CDP session.
