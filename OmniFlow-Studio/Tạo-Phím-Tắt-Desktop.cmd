@echo off
set "CURRENT_DIR=%~dp0"
set "PS_SCRIPT=%CURRENT_DIR%scripts\create-desktop-shortcut.ps1"

if not exist "%PS_SCRIPT%" (
    set "PS_SCRIPT=%CURRENT_DIR%OmniFlow-Studio\scripts\create-desktop-shortcut.ps1"
)

if not exist "%PS_SCRIPT%" (
    if exist "%CURRENT_DIR%create-desktop-shortcut.ps1" (
        set "PS_SCRIPT=%CURRENT_DIR%create-desktop-shortcut.ps1"
    )
)

if not exist "%PS_SCRIPT%" (
    echo [ERROR] create-desktop-shortcut.ps1 not found.
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Desktop shortcut created successfully!
) else (
    echo [ERROR] Failed to create desktop shortcut.
    exit /b 1
)
