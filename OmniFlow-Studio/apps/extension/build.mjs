// ============================================================
// OmniFlow Studio — Extension Build & Packaging Script (esbuild)
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_ROOT = __dirname;
const MONOREPO_ROOT = path.resolve(EXTENSION_ROOT, '../..');
const WORKSPACE_ROOT = path.resolve(MONOREPO_ROOT, '..');

const DIST_DIR = path.resolve(EXTENSION_ROOT, 'dist');
const RELEASE_EXT_DIR = path.resolve(MONOREPO_ROOT, 'release/extension');
const ROOT_RELEASE_EXT_DIR = path.resolve(WORKSPACE_ROOT, 'release/extension');

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch {
    const pnpmDir = path.join(MONOREPO_ROOT, 'node_modules', '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      const match = fs.readdirSync(pnpmDir).find((d) => d.startsWith('esbuild@'));
      if (match) {
        const entry = path.join(pnpmDir, match, 'node_modules', 'esbuild', 'lib', 'main.js');
        if (fs.existsSync(entry)) {
          return await import(pathToFileURL(entry).href);
        }
      }
    }
    throw new Error('esbuild not found in node_modules');
  }
}

console.log('🚀 [OmniFlow Extension] Starting standalone build process...');

// 1. Clean dist directory
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(DIST_DIR, { recursive: true });

// 2. Bundle TypeScript entrypoints with esbuild
console.log('📦 Bundling TypeScript entrypoints with esbuild...');
const esbuild = await loadEsbuild();

const entryPoints = [
  { in: 'src/background/index.ts', out: 'background/index', format: 'esm' },
  { in: 'src/popup/popup.ts', out: 'popup/popup', format: 'esm' },
  { in: 'src/sidepanel/sidepanel.ts', out: 'sidepanel/sidepanel', format: 'esm' },
  { in: 'src/content/pos-autofill.ts', out: 'content/pos-autofill', format: 'iife' },
  { in: 'src/content/sap-autofill.ts', out: 'content/sap-autofill', format: 'iife' },
];

for (const ep of entryPoints) {
  const inputPath = path.join(EXTENSION_ROOT, ep.in);
  const outFile = path.join(DIST_DIR, `${ep.out}.js`);
  await esbuild.build({
    entryPoints: [inputPath],
    outfile: outFile,
    bundle: true,
    platform: 'browser',
    target: ['chrome120'],
    format: ep.format,
    sourcemap: false,
    minify: false,
    logLevel: 'info',
  });
}

// 3. Copy Static Files to dist
function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

console.log('📋 Copying manifest, assets and HTML/CSS templates...');
copyFile(path.join(EXTENSION_ROOT, 'public/manifest.json'), path.join(DIST_DIR, 'manifest.json'));
copyDir(path.join(EXTENSION_ROOT, 'public/icons'), path.join(DIST_DIR, 'icons'));

copyFile(path.join(EXTENSION_ROOT, 'src/popup/index.html'), path.join(DIST_DIR, 'popup/index.html'));
copyFile(path.join(EXTENSION_ROOT, 'src/popup/popup.css'), path.join(DIST_DIR, 'popup/popup.css'));

copyFile(path.join(EXTENSION_ROOT, 'src/sidepanel/index.html'), path.join(DIST_DIR, 'sidepanel/index.html'));
copyFile(path.join(EXTENSION_ROOT, 'src/sidepanel/sidepanel.css'), path.join(DIST_DIR, 'sidepanel/sidepanel.css'));

copyFile(path.join(EXTENSION_ROOT, 'src/content/content.css'), path.join(DIST_DIR, 'content/content.css'));

if (fs.existsSync(path.join(EXTENSION_ROOT, 'README.md'))) {
  copyFile(path.join(EXTENSION_ROOT, 'README.md'), path.join(DIST_DIR, 'README.md'));
}
if (fs.existsSync(path.join(EXTENSION_ROOT, 'docs'))) {
  copyDir(path.join(EXTENSION_ROOT, 'docs'), path.join(DIST_DIR, 'docs'));
}

// 4. Sync to release directories
console.log('🚚 Synchronizing to release directories:');
console.log(`   -> ${RELEASE_EXT_DIR}`);
console.log(`   -> ${ROOT_RELEASE_EXT_DIR}`);

function syncToRelease(targetDir) {
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(DIST_DIR, targetDir);
}

syncToRelease(RELEASE_EXT_DIR);
syncToRelease(ROOT_RELEASE_EXT_DIR);

// 4b. Package OmniFlow-Extension-v2.1.0.zip
const RELEASE_ZIP = path.resolve(MONOREPO_ROOT, 'release/OmniFlow-Extension-v2.1.0.zip');
const ROOT_RELEASE_ZIP = path.resolve(WORKSPACE_ROOT, 'release/OmniFlow-Extension-v2.1.0.zip');
console.log('📦 Packaging OmniFlow-Extension-v2.1.0.zip...');
if (process.platform === 'win32') {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${ROOT_RELEASE_EXT_DIR}\\*' -DestinationPath '${ROOT_RELEASE_ZIP}' -Force"`,
    { stdio: 'inherit' }
  );
  fs.copyFileSync(ROOT_RELEASE_ZIP, RELEASE_ZIP);
} else {
  execSync(`cd "${ROOT_RELEASE_EXT_DIR}" && zip -rq "${ROOT_RELEASE_ZIP}" .`, { stdio: 'inherit' });
  fs.copyFileSync(ROOT_RELEASE_ZIP, RELEASE_ZIP);
}

// 5. Verify Build Output
console.log('\n🔍 Verifying build output:');
const requiredFiles = [
  'manifest.json',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
  'background/index.js',
  'popup/index.html',
  'popup/popup.js',
  'popup/popup.css',
  'sidepanel/index.html',
  'sidepanel/sidepanel.js',
  'sidepanel/sidepanel.css',
  'content/pos-autofill.js',
  'content/sap-autofill.js',
  'content/content.css',
  'docs/WORKFLOW_KNOWLEDGE.md',
];

let allPassed = true;
for (const relPath of requiredFiles) {
  const filePath = path.join(ROOT_RELEASE_EXT_DIR, relPath);
  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size;
    console.log(`  ✓ ${relPath.padEnd(26)} [${size} bytes]`);
  } else {
    console.error(`  ✗ MISSING: ${relPath}`);
    allPassed = false;
  }
}

if (!allPassed) {
  console.error('\n❌ Build verification failed: some required files are missing.');
  process.exit(1);
}

console.log('\n🎉 OmniFlow Studio Standalone Extension v2.1.0 build completed successfully!');
console.log(`Ready to load in Chrome / Edge at: ${ROOT_RELEASE_EXT_DIR}`);
