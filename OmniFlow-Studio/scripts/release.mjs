// FM AUTO OPS — Local Release Build Automation
// Automates prerequisites check, monorepo build, E2E validation, and Electron packaging.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const LOCAL_AGENT_DIR = path.join(ROOT_DIR, 'apps/local-agent');
const WEB_DIST_DIR = path.join(ROOT_DIR, 'apps/web/dist');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const ASSETS_ICON = path.join(ROOT_DIR, 'assets/app-icon.ico');

// Parse CLI flags
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const skipTests = args.includes('--skip-tests');
const helpFlag = args.includes('--help') || args.includes('-h');

if (helpFlag) {
  console.log(`
FM AUTO OPS — Release Automation Tool
Usage:
  node scripts/release.mjs [options]

Options:
  --dry-run      Run build verification and fast dir-pack without full NSIS compression
  --skip-tests   Skip running E2E test verification before packaging
  --help, -h     Show this help message
`);
  process.exit(0);
}

function log(section, msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[${ts}] [${section}] ${msg}`);
}

function runCommand(command, cmdArgs, cwd = ROOT_DIR, env = process.env) {
  log('EXEC', `${command} ${cmdArgs.join(' ')} (in ${path.relative(ROOT_DIR, cwd) || '.'})`);
  const isWindows = process.platform === 'win32';
  const effectiveCmd = (command === 'node')
    ? process.execPath
    : (isWindows && !command.endsWith('.cmd') && !command.endsWith('.exe') && !command.endsWith('.bat')
      ? `${command}.cmd`
      : command);

  // Try direct spawn without shell to avoid DEP0190, fallback to shell string if needed
  let res = spawnSync(effectiveCmd, cmdArgs, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });

  if (res.error && isWindows) {
    res = spawnSync(`${effectiveCmd} ${cmdArgs.join(' ')}`, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: true,
    });
  }

  if (res.status !== 0) {
    throw new Error(`Command failed with exit code ${res.status}: ${command} ${cmdArgs.join(' ')}`);
  }
}

function computeSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function main() {
  console.log('====================================================');
  console.log('       FM AUTO OPS — Release Build Runner           ');
  console.log('====================================================');
  log('INIT', `Root directory: ${ROOT_DIR}`);
  log('INIT', `Mode: ${isDryRun ? 'DRY-RUN (verification only)' : 'FULL RELEASE'}`);

  // 1. Verify Prerequisites
  log('PREFLIGHT', 'Checking system environment and prerequisites...');
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) {
    throw new Error(`Node.js version 20+ required. Current version: ${process.version}`);
  }
  log('PREFLIGHT', `Node.js version: ${process.version} (OK)`);

  if (!fs.existsSync(ASSETS_ICON)) {
    throw new Error(`Required application icon missing at: ${ASSETS_ICON}`);
  }
  log('PREFLIGHT', `Application icon found at: ${ASSETS_ICON} (${fs.statSync(ASSETS_ICON).size} bytes)`);

  const agentPkgPath = path.join(LOCAL_AGENT_DIR, 'package.json');
  if (!fs.existsSync(agentPkgPath)) {
    throw new Error(`Local agent package.json not found at: ${agentPkgPath}`);
  }
  const agentPkg = JSON.parse(fs.readFileSync(agentPkgPath, 'utf8'));
  const buildConfig = agentPkg.build || {};
  const targets = (buildConfig.win && buildConfig.win.target) || [];

  if (!targets.includes('nsis') || !targets.includes('zip')) {
    throw new Error(`apps/local-agent package.json win.target must include both 'nsis' and 'zip'. Current: ${JSON.stringify(targets)}`);
  }
  log('PREFLIGHT', `Builder targets: ${JSON.stringify(targets)} (OK)`);

  const extraResources = buildConfig.extraResources || [];
  const bundlesWeb = extraResources.some(r => r.from && r.from.includes('web') && r.to && r.to.includes('web'));
  if (!bundlesWeb) {
    throw new Error('apps/local-agent package.json extraResources must bundle web/dist');
  }
  log('PREFLIGHT', 'ExtraResources web UI configuration verified (OK)');

  // 2. Run Pre-Release Tests if not skipped
  if (!skipTests) {
    log('TEST', 'Running E2E Distribution Test Suite...');
    runCommand('node', ['--test', 'tests/e2e/r7-github-distribution.test.mjs']);
    log('TEST', 'E2E Distribution Tests passed successfully.');
  } else {
    log('TEST', 'Skipping test suite (--skip-tests specified).');
  }

  // 3. Monorepo Build (apps/web and packages)
  log('BUILD', 'Building all monorepo workspaces...');
  runCommand('pnpm', ['run', 'build']);

  const indexHtmlPath = path.join(WEB_DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(`Build completed but Web UI dist not found at: ${indexHtmlPath}`);
  }
  log('BUILD', `Web UI distribution confirmed at: ${indexHtmlPath} (${fs.statSync(indexHtmlPath).size} bytes)`);

  // 4. Execute Installer Packaging
  log('PACKAGE', isDryRun ? 'Executing dry-run directory packaging...' : 'Executing Electron installer & zip packaging...');
  if (isDryRun) {
    runCommand('pnpm', ['--filter', '@fm/local-agent', 'exec', 'electron-builder', '--dir'], ROOT_DIR, {
      GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || 'dummy_token',
    });
  } else {
    runCommand('pnpm', ['--filter', '@fm/local-agent', 'build:installer'], ROOT_DIR, {
      GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || 'dummy_token',
    });
  }

  // 5. Inspect Release Output Directory
  log('ARTIFACTS', `Scanning release artifacts in: ${RELEASE_DIR}`);
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const entries = fs.readdirSync(RELEASE_DIR);
  const releaseFiles = entries.filter(f => f.endsWith('.exe') || f.endsWith('.zip') || f.endsWith('.blockmap') || f.endsWith('.yml'));

  if (releaseFiles.length === 0) {
    log('ARTIFACTS', 'Note: No packaged .exe or .zip files found in release directory yet (normal in unpacked dry-run mode).');
  } else {
    console.log('\nGenerated Release Artifacts:');
    console.log('--------------------------------------------------------------------------------------------------------');
    console.log('File Name                                       | Size         | SHA-256');
    console.log('--------------------------------------------------------------------------------------------------------');
    for (const f of releaseFiles) {
      const fullPath = path.join(RELEASE_DIR, f);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        const hash = computeSha256(fullPath).substring(0, 16) + '...';
        console.log(`${f.padEnd(47)} | ${formatBytes(stat.size).padEnd(12)} | ${hash}`);
      }
    }
    console.log('--------------------------------------------------------------------------------------------------------\n');
  }

  log('SUCCESS', 'Release automation workflow completed successfully!');
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
