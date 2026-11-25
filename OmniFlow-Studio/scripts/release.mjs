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

export function computeSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Validates electron-builder Windows targets, permitting and detecting 'portable'.
 */
export function validateTargets(targets) {
  const targetList = Array.isArray(targets) ? targets : (targets ? [targets] : []);
  const targetNames = targetList.map(t => (typeof t === 'string' ? t.toLowerCase() : (t && t.target ? t.target.toLowerCase() : '')));
  const hasNsis = targetNames.includes('nsis');
  const hasZip = targetNames.includes('zip');
  const hasPortable = targetNames.includes('portable');
  const valid = hasNsis && hasZip;
  return { valid, hasNsis, hasZip, hasPortable, targetNames };
}

/**
 * Scans release directory and categorizes distribution artifacts (NSIS installer, portable exe, portable zip).
 */
export function detectArtifacts(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath);
  return entries
    .filter(f => f.endsWith('.exe') || f.endsWith('.zip'))
    .map(name => {
      const fullPath = path.join(dirPath, name);
      const stat = fs.statSync(fullPath);
      const isPortable = name.toLowerCase().includes('portable') || name.endsWith('.zip');
      const type = name.endsWith('.zip')
        ? 'portable-zip'
        : name.toLowerCase().includes('portable')
          ? 'portable-exe'
          : 'nsis-installer';
      return {
        name,
        fullPath,
        size: stat.size,
        type,
        isPortable,
        sha256: computeSha256(fullPath),
      };
    });
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
  const targetValidation = validateTargets(targets);

  if (!targetValidation.hasNsis || !targetValidation.hasZip) {
    throw new Error(`apps/local-agent package.json win.target must include both 'nsis' and 'zip'. Current: ${JSON.stringify(targets)}`);
  }
  log('PREFLIGHT', `Builder targets: ${JSON.stringify(targetValidation.targetNames)} (nsis: OK, zip: OK, portable: ${targetValidation.hasPortable ? 'ENABLED' : 'OPTIONAL'})`);

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
  // `release/` is generated output. Clear only known Electron Builder outputs so
  // renamed artifacts from older builds cannot be mistaken for this release.
  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  for (const entry of fs.readdirSync(RELEASE_DIR, { withFileTypes: true })) {
    const entryPath = path.join(RELEASE_DIR, entry.name);
    const isUnpackedBuild = entry.isDirectory() && entry.name === 'win-unpacked';
    const isBuilderMetadata = entry.isFile() && entry.name === 'builder-debug.yml';
    const isDistributionArtifact = entry.isFile()
      && /^OmniFlow(?: Studio)?(?:-Studio)?(?:-v?\d| Setup )?.*\.(?:exe|zip|blockmap)$/i.test(entry.name);
    if (isUnpackedBuild) {
      fs.rmSync(entryPath, { recursive: true, force: true });
    } else if (isBuilderMetadata || isDistributionArtifact) {
      fs.rmSync(entryPath, { force: true });
    }
  }

  const packagingEnv = { ...process.env };
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    packagingEnv.GH_TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  }

  log('PACKAGE', isDryRun ? 'Executing dry-run directory packaging...' : 'Executing Electron installer & zip packaging...');
  if (isDryRun) {
    runCommand('pnpm', ['--filter', '@fm/local-agent', 'exec', 'electron-builder', '--dir'], ROOT_DIR, packagingEnv);
  } else {
    runCommand('pnpm', ['--filter', '@fm/local-agent', 'build:installer'], ROOT_DIR, packagingEnv);
  }

  // 5. Inspect Release Output Directory
  log('ARTIFACTS', `Scanning release artifacts in: ${RELEASE_DIR}`);
  if (!fs.existsSync(RELEASE_DIR)) {
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
  }

  const artifacts = detectArtifacts(RELEASE_DIR);
  const portableCount = artifacts.filter(a => a.isPortable).length;
  const installerCount = artifacts.filter(a => a.type === 'nsis-installer').length;

  if (artifacts.length === 0) {
    log('ARTIFACTS', 'Note: No packaged .exe or .zip files found in release directory yet (normal in unpacked dry-run mode).');
  } else {
    log('ARTIFACTS', `Detected ${artifacts.length} release artifact(s) (${portableCount} portable, ${installerCount} installer).`);
    console.log('\nGenerated Release Artifacts:');
    console.log('-------------------------------------------------------------------------------------------------------------------');
    console.log('File Name                                       | Type          | Size         | SHA-256');
    console.log('-------------------------------------------------------------------------------------------------------------------');
    for (const a of artifacts) {
      const hash = a.sha256.substring(0, 16) + '...';
      const typeLabel = a.type === 'portable-exe'
        ? 'Portable EXE'
        : a.type === 'portable-zip'
          ? 'Portable ZIP'
          : 'NSIS Installer';
      console.log(`${a.name.padEnd(47)} | ${typeLabel.padEnd(13)} | ${formatBytes(a.size).padEnd(12)} | ${hash}`);
    }
    console.log('-------------------------------------------------------------------------------------------------------------------\n');
  }

  log('SUCCESS', 'Release automation workflow completed successfully!');
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectExecution) {
  main().catch(err => {
    console.error('\n[FATAL ERROR]', err.message);
    process.exit(1);
  });
}
