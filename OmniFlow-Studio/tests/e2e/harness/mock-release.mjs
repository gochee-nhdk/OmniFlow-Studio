// FM AUTO OPS — Release & Packaging Validator Engine
// Validates electron-builder package.json and GitHub Actions release workflow structure.

import fs from 'node:fs';
import path from 'node:path';

export class MockReleaseValidator {
  /**
   * Validate electron-builder configuration in package.json object or file
   */
  static validatePackageConfig(pkg) {
    const errors = [];
    if (!pkg.build) {
      errors.push('Missing "build" configuration in package.json');
      return { valid: false, errors };
    }

    const win = pkg.build.win || {};
    const targets = Array.isArray(win.target) ? win.target : (win.target ? [win.target] : []);

    const hasNsis = targets.some(t => (typeof t === 'string' ? t.toLowerCase() === 'nsis' : t.target === 'nsis'));
    if (!hasNsis) {
      errors.push('build.win.target must include "nsis"');
    }

    const hasZip = targets.some(t => (typeof t === 'string' ? t.toLowerCase() === 'zip' : t.target === 'zip'));
    if (!hasZip) {
      errors.push('build.win.target must include "zip"');
    }

    // Check extraResources for bundling web/dist
    const extraResources = pkg.build.extraResources || [];
    const hasWebDist = Array.isArray(extraResources) && extraResources.some(r => {
      if (typeof r === 'string') return r.includes('web/dist') || r.includes('web\\dist');
      if (typeof r === 'object' && r !== null) {
        return (r.from && r.from.includes('web')) || (r.to && r.to.includes('web'));
      }
      return false;
    });

    if (!hasWebDist) {
      errors.push('build.extraResources must bundle "apps/web/dist" into "web/dist"');
    }

    return {
      valid: errors.length === 0,
      hasNsis,
      hasZip,
      hasWebDist,
      errors,
    };
  }

  /**
   * Validate a package.json file on disk
   */
  static validatePackageJson(filePath) {
    if (!fs.existsSync(filePath)) {
      return { valid: false, errors: [`File not found: ${filePath}`] };
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const pkg = JSON.parse(content);
      return this.validatePackageConfig(pkg);
    } catch (e) {
      return { valid: false, errors: [`JSON parse error: ${e.message}`] };
    }
  }

  /**
   * Validate GitHub Actions release workflow YAML structure
   */
  static validateWorkflowContent(yamlContent) {
    const errors = [];

    // Check triggers: tags matching v*.*.* or v*
    const hasTagTrigger = /tags:\s*(\n\s*-\s*['"]?v|\[.*v)/m.test(yamlContent);
    if (!hasTagTrigger) {
      errors.push('Workflow must trigger on tag push matching v* pattern');
    }

    // Check runner: windows-latest
    const hasWindowsRunner = /runs-on:\s*windows-latest/i.test(yamlContent);
    if (!hasWindowsRunner) {
      errors.push('Workflow jobs must execute on "windows-latest" runner');
    }

    // Check build step order: web build or monorepo build before electron-builder
    const hasBuildStep = /run:\s*.*(?:pnpm|npm).*(?:build|web:build)/i.test(yamlContent);
    if (!hasBuildStep) {
      errors.push('Workflow must contain workspace / frontend build step');
    }

    const hasPackagingStep = /electron-builder/i.test(yamlContent) || /build:installer/i.test(yamlContent);
    if (!hasPackagingStep) {
      errors.push('Workflow must execute electron-builder packaging');
    }

    // Check asset upload action
    const hasReleaseAction = /(?:softprops\/action-gh-release|actions\/create-release|gh release create)/i.test(yamlContent);
    if (!hasReleaseAction) {
      errors.push('Workflow must include GitHub Release creation/upload step');
    }

    return {
      valid: errors.length === 0,
      hasTagTrigger,
      hasWindowsRunner,
      hasBuildStep,
      hasPackagingStep,
      hasReleaseAction,
      errors,
    };
  }

  /**
   * Validate workflow file on disk
   */
  static validateWorkflowYaml(filePath) {
    if (!fs.existsSync(filePath)) {
      return { valid: false, errors: [`File not found: ${filePath}`] };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return this.validateWorkflowContent(content);
  }
}
