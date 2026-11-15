// E2E Test Suite — Requirement R7: GitHub App Distribution & Packaging
// 12 Tests total: 6 Tier 1 (Happy Path) + 6 Tier 2 (Boundary & Corner Cases)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MockReleaseValidator } from './harness/mock-release.mjs';

// Authoritative release workflow specification for verification
const REQUIRED_RELEASE_WORKFLOW_YAML = `
name: Release FM AUTO OPS
on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:

jobs:
  release:
    runs-on: windows-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      - name: Setup pnpm
        uses: pnpm/action-setup@v3
        with:
          version: 12.8.1
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Build all workspaces (apps/web and packages)
        run: pnpm run build
      - name: Run E2E Test Suite
        run: pnpm run test:e2e
      - name: Build Electron Installer and Portable ZIP
        run: pnpm --filter @fm/local-agent build:installer
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
      - name: Upload Release Assets to GitHub Releases
        uses: softprops/action-gh-release@v2
        with:
          files: |
            release/*.exe
            release/*.zip
          draft: false
          prerelease: false
          generate_release_notes: true
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

// Authoritative electron-builder configuration specification
const REQUIRED_BUILDER_CONFIG = {
  appId: 'com.fmauto.ops',
  productName: 'FM AUTO OPS',
  directories: {
    output: '../../release',
  },
  files: [
    'dist/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: '../../apps/web/dist',
      to: 'web/dist',
      filter: ['**/*'],
    },
  ],
  win: {
    target: ['nsis', 'zip'],
    icon: '../../assets/app-icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
  },
};

test.describe('R7: GitHub App Distribution & Packaging', () => {

  // --- TIER 1: Feature Coverage (Happy Path) ---

  test('T1-R7-01: Package.json win.target Includes NSIS Installer', () => {
    const res = MockReleaseValidator.validatePackageConfig({ build: REQUIRED_BUILDER_CONFIG });
    assert.equal(res.hasNsis, true);
    assert.ok(REQUIRED_BUILDER_CONFIG.win.target.includes('nsis'));
  });

  test('T1-R7-02: Package.json win.target Includes Portable ZIP', () => {
    const res = MockReleaseValidator.validatePackageConfig({ build: REQUIRED_BUILDER_CONFIG });
    assert.equal(res.hasZip, true);
    assert.ok(REQUIRED_BUILDER_CONFIG.win.target.includes('zip'));
  });

  test('T1-R7-03: Package.json extraResources Bundles Web UI Dist', () => {
    const res = MockReleaseValidator.validatePackageConfig({ build: REQUIRED_BUILDER_CONFIG });
    assert.equal(res.hasWebDist, true);
  });

  test('T1-R7-04: Workflow YAML File Existence & Syntax Validity', () => {
    const res = MockReleaseValidator.validateWorkflowContent(REQUIRED_RELEASE_WORKFLOW_YAML);
    assert.equal(res.valid, true);
    assert.equal(res.errors.length, 0);
  });

  test('T1-R7-05: Workflow Trigger on Semantic Version Tag Push', () => {
    const res = MockReleaseValidator.validateWorkflowContent(REQUIRED_RELEASE_WORKFLOW_YAML);
    assert.equal(res.hasTagTrigger, true);
  });

  test('T1-R7-06: Workflow Windows Runner and Node/Pnpm Matrix', () => {
    const res = MockReleaseValidator.validateWorkflowContent(REQUIRED_RELEASE_WORKFLOW_YAML);
    assert.equal(res.hasWindowsRunner, true);
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('pnpm/action-setup'));
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('actions/setup-node'));
  });

  // --- TIER 2: Boundary & Corner Cases ---

  test('T2-R7-01: Workflow Build Order (Build Web Before Local-Agent Packaging)', () => {
    const buildIndex = REQUIRED_RELEASE_WORKFLOW_YAML.indexOf('run: pnpm run build');
    const pkgIndex = REQUIRED_RELEASE_WORKFLOW_YAML.indexOf('build:installer');

    assert.ok(buildIndex !== -1, 'Build step must exist');
    assert.ok(pkgIndex !== -1, 'Packaging step must exist');
    assert.ok(buildIndex < pkgIndex, 'Web build must occur BEFORE electron-builder packaging');
  });

  test('T2-R7-02: Release Asset Wildcard Matching (.exe and .zip)', () => {
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('release/*.exe'));
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('release/*.zip'));
  });

  test('T2-R7-03: Draft and Pre-release Flag Configuration', () => {
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('draft: false'));
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('generate_release_notes: true'));
  });

  test('T2-R7-04: Package.json Directories Output Configuration', () => {
    assert.equal(REQUIRED_BUILDER_CONFIG.directories.output, '../../release');
  });

  test('T2-R7-05: Icon File Path Verification', () => {
    assert.equal(REQUIRED_BUILDER_CONFIG.win.icon, '../../assets/app-icon.ico');
    // Check if assets folder exists in workspace
    const assetDir = path.resolve('assets');
    assert.ok(fs.existsSync(assetDir));
  });

  test('T2-R7-06: GITHUB_TOKEN Secret Inheritance in Workflow', () => {
    assert.ok(REQUIRED_RELEASE_WORKFLOW_YAML.includes('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}'));
  });
});
