# Windows desktop launch

The Windows installer creates the OmniFlow Studio desktop shortcut. The app stores its SQLite database, encrypted credentials, logs, and temporary downloads under Electron's per-user `userData` directory. Exported reports use the user's Documents folder unless a different destination is selected.

The optional `scripts/create-desktop-shortcut.ps1` helper creates a shortcut for a standard per-user NSIS installation. It does not contain a developer-specific path.

The standalone web preview (`Open_Web_Dashboard.bat` / `.vbs`) is for source checkout development only. It uses the repository's built `apps/web/dist` and does not provide desktop IPC or automation capabilities.
