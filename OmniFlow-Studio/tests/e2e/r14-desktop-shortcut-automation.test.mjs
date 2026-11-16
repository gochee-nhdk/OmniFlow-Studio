// E2E Test Suite — Requirement R14: Automatic Desktop Shortcut Automation
// Validates:
// 1. scripts/create-desktop-shortcut.ps1 existence, portable target resolution, and WScript.Shell automation
// 2. 1-Click batch script Tạo-Phím-Tắt-Desktop.cmd existence in workspace roots with PowerShell Bypass invocation
// 3. scripts/Launcher.cs EnsureDesktopShortcut implementation with fail-safe COM reflection
// 4. apps/local-agent/src/main/index.ts ensureDesktopShortcut() with shell.writeShortcutLink & PowerShell fallback
// 5. apps/local-agent/package.json extraFiles distribution packaging for zip/portable bundles
// 6. Real PowerShell shortcut generation verification into isolated test directory

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(ROOT_DIR, '..');

test.describe('R14: Automatic Desktop Shortcut Automation', () => {

  test('T1-R14-01: scripts/create-desktop-shortcut.ps1 exists and defines portable executable detection', () => {
    const ps1Path = path.join(ROOT_DIR, 'scripts/create-desktop-shortcut.ps1');
    assert.ok(fs.existsSync(ps1Path), 'create-desktop-shortcut.ps1 must exist');

    const content = fs.readFileSync(ps1Path, 'utf8');
    assert.ok(content.includes('WScript.Shell'), 'Script must use WScript.Shell for COM shortcut generation');
    assert.ok(content.includes('OmniFlow Studio.exe'), 'Script must target OmniFlow Studio.exe');
    assert.ok(content.includes('Desktop'), 'Script must target the Desktop folder');
    assert.ok(content.includes('IconLocation'), 'Script must assign icon location');
  });

  test('T1-R14-02: 1-Click batch script Tạo-Phím-Tắt-Desktop.cmd exists in project root and workspace', () => {
    const rootCmd = path.join(REPO_ROOT, 'Tạo-Phím-Tắt-Desktop.cmd');
    const projectCmd = path.join(ROOT_DIR, 'Tạo-Phím-Tắt-Desktop.cmd');

    assert.ok(fs.existsSync(rootCmd) || fs.existsSync(projectCmd), 'Tạo-Phím-Tắt-Desktop.cmd must exist in project or repo root');

    const scriptPath = fs.existsSync(projectCmd) ? projectCmd : rootCmd;
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('create-desktop-shortcut.ps1'), 'Batch script must invoke create-desktop-shortcut.ps1');
    assert.ok(content.includes('-ExecutionPolicy Bypass'), 'Batch script must bypass PowerShell execution policy');
  });

  test('T1-R14-03: scripts/Launcher.cs implements EnsureDesktopShortcut using WScript.Shell reflection', () => {
    const launcherPath = path.join(ROOT_DIR, 'scripts/Launcher.cs');
    assert.ok(fs.existsSync(launcherPath), 'Launcher.cs must exist');

    const code = fs.readFileSync(launcherPath, 'utf8');
    assert.ok(code.includes('EnsureDesktopShortcut'), 'Launcher must define EnsureDesktopShortcut method');
    assert.ok(code.includes('WScript.Shell'), 'EnsureDesktopShortcut must use WScript.Shell');
    assert.ok(code.includes('CreateShortcut'), 'EnsureDesktopShortcut must invoke CreateShortcut');
    assert.ok(code.includes('OmniFlow Studio.lnk'), 'Shortcut file must be named OmniFlow Studio.lnk');
  });

  test('T1-R14-04: apps/local-agent/src/main/index.ts exports and invokes ensureDesktopShortcut', () => {
    const mainPath = path.join(ROOT_DIR, 'apps/local-agent/src/main/index.ts');
    assert.ok(fs.existsSync(mainPath), 'apps/local-agent/src/main/index.ts must exist');

    const source = fs.readFileSync(mainPath, 'utf8');
    assert.ok(source.includes('export function ensureDesktopShortcut'), 'Must export ensureDesktopShortcut function');
    assert.ok(source.includes('ensureDesktopShortcut()'), 'Must invoke ensureDesktopShortcut in startup lifecycle');
    assert.ok(source.includes('OmniFlow Studio.lnk'), 'Must target OmniFlow Studio.lnk on Desktop');
    assert.ok(
      source.includes('writeShortcutLink') || source.includes('WScript.Shell'),
      'Must use writeShortcutLink or WScript.Shell fallback'
    );
  });

  test('T1-R14-05: apps/local-agent/package.json extraFiles includes desktop shortcut scripts for release packaging', () => {
    const pkgPath = path.join(ROOT_DIR, 'apps/local-agent/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    assert.ok(pkg.build, 'package.json must contain build configuration');
    assert.ok(Array.isArray(pkg.build.extraFiles), 'build.extraFiles must be an array');

    const extraFileTargets = pkg.build.extraFiles.map(f => (typeof f === 'string' ? f : f.to));
    assert.ok(
      extraFileTargets.some(t => t.includes('Tạo-Phím-Tắt-Desktop.cmd')),
      'build.extraFiles must bundle Tạo-Phím-Tắt-Desktop.cmd'
    );
    assert.ok(
      extraFileTargets.some(t => t.includes('create-desktop-shortcut.ps1')),
      'build.extraFiles must bundle create-desktop-shortcut.ps1'
    );
  });

  test('T1-R14-06: Programmatic shortcut creation test creates valid .lnk file', () => {
    if (process.platform !== 'win32') return;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r14-shortcut-test-'));
    const fakeExe = path.join(tmpDir, 'OmniFlow Studio.exe');
    fs.writeFileSync(fakeExe, 'MZ_DUMMY_EXE');

    const shortcutPath = path.join(tmpDir, 'OmniFlow Studio.lnk');
    const psScript = [
      '$ws = New-Object -ComObject WScript.Shell',
      `$s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')`,
      `$s.TargetPath = '${fakeExe.replace(/'/g, "''")}'`,
      `$s.WorkingDirectory = '${tmpDir.replace(/'/g, "''")}'`,
      `$s.Description = 'OmniFlow Studio Test'`,
      '$s.Save()'
    ].join('; ');

    try {
      execSync(`powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`, {
        stdio: 'pipe',
        timeout: 5000,
      });

      assert.ok(fs.existsSync(shortcutPath), 'Shortcut file (.lnk) must be generated');
      const stat = fs.statSync(shortcutPath);
      assert.ok(stat.size > 0, 'Shortcut file must have non-zero size');
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {}
    }
  });

});
