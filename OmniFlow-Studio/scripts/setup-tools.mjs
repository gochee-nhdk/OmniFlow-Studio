#!/usr/bin/env node

/**
 * FM-AUTO-OPS Tooling Ecosystem Setup Script
 * Clones, vendors, configures, and integrates:
 *  1. affaan-m/ECC
 *  2. Graphify-Labs/graphify
 *  3. DietrichGebert/ponytail
 *  4. github/spec-kit
 *  5. mattpocock/skills
 *  6. Addy Osmani Agent Skills
 *  7. Microsoft Playwright CLI and TestDino / Lackey Playwright skills
 *
 * Performs clean vendoring (removes nested .git directories to prevent submodule gitlink collisions),
 * creates tools/manifest.json, configures runtimes, and copies key agent skills into .agents/skills/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, readdirSync, statSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const TOOLS_DIR = join(PROJECT_ROOT, 'tools');
const AGENTS_SKILLS_DIR = join(PROJECT_ROOT, '.agents', 'skills');

const REPOSITORIES = [
  {
    name: 'addyosmani-agent-skills',
    url: 'https://github.com/addyosmani/agent-skills.git',
    targetDir: join(TOOLS_DIR, 'addyosmani-agent-skills'),
    description: 'Engineering workflow skills by Addy Osmani',
    setupType: 'skills'
  },
  {
    name: 'playwright-cli',
    url: 'https://github.com/microsoft/playwright-cli.git',
    targetDir: join(TOOLS_DIR, 'playwright-cli'),
    description: 'Microsoft Playwright CLI and browser automation skills',
    setupType: 'npm'
  },
  {
    name: 'testdino-playwright-skill',
    url: 'https://github.com/testdino-hq/playwright-skill.git',
    targetDir: join(TOOLS_DIR, 'testdino-playwright-skill'),
    description: 'Playwright testing guides and skills',
    setupType: 'skills'
  },
  {
    name: 'lackeyjb-playwright-skill',
    url: 'https://github.com/lackeyjb/playwright-skill.git',
    targetDir: join(TOOLS_DIR, 'lackeyjb-playwright-skill'),
    description: 'Playwright automation skill',
    setupType: 'skills'
  },
  {
    name: 'ecc',
    url: 'https://github.com/affaan-m/ECC.git',
    targetDir: join(TOOLS_DIR, 'ecc'),
    description: 'Enterprise Cursor Control / multi-agent coordination and security scanning',
    setupType: 'npm'
  },
  {
    name: 'graphify',
    url: 'https://github.com/Graphify-Labs/graphify.git',
    targetDir: join(TOOLS_DIR, 'graphify'),
    description: 'Codebase knowledge graph generation and dependency intelligence',
    setupType: 'uv'
  },
  {
    name: 'ponytail',
    url: 'https://github.com/DietrichGebert/ponytail.git',
    targetDir: join(TOOLS_DIR, 'ponytail'),
    description: 'Lazy senior developer philosophy and anti-overengineering skills',
    setupType: 'none'
  },
  {
    name: 'spec-kit',
    url: 'https://github.com/github/spec-kit.git',
    targetDir: join(TOOLS_DIR, 'spec-kit'),
    description: 'Spec-Driven Development (SDD) toolkit and specification templates',
    setupType: 'uv'
  },
  {
    name: 'mattpocock-skills',
    url: 'https://github.com/mattpocock/skills.git',
    targetDir: join(TOOLS_DIR, 'mattpocock-skills'),
    description: 'Matt Pocock curated engineering & productivity agent skills',
    setupType: 'none'
  }
];

const SKILLS_TO_DEPLOY = [
  {
    id: 'tdd',
    source: join(TOOLS_DIR, 'mattpocock-skills', 'skills', 'engineering', 'tdd'),
    target: join(AGENTS_SKILLS_DIR, 'tdd')
  },
  {
    id: 'diagnosing-bugs',
    source: join(TOOLS_DIR, 'mattpocock-skills', 'skills', 'engineering', 'diagnosing-bugs'),
    target: join(AGENTS_SKILLS_DIR, 'diagnosing-bugs')
  },
  {
    id: 'code-review',
    source: join(TOOLS_DIR, 'mattpocock-skills', 'skills', 'engineering', 'code-review'),
    target: join(AGENTS_SKILLS_DIR, 'code-review')
  },
  {
    id: 'domain-modeling',
    source: join(TOOLS_DIR, 'mattpocock-skills', 'skills', 'engineering', 'domain-modeling'),
    target: join(AGENTS_SKILLS_DIR, 'domain-modeling')
  },
  {
    id: 'implement-spec',
    source: join(TOOLS_DIR, 'mattpocock-skills', 'skills', 'engineering', 'implement-spec'),
    target: join(AGENTS_SKILLS_DIR, 'implement-spec')
  },
  {
    id: 'ponytail',
    source: join(TOOLS_DIR, 'ponytail', 'skills', 'ponytail'),
    target: join(AGENTS_SKILLS_DIR, 'ponytail')
  },
  {
    id: 'ponytail-review',
    source: join(TOOLS_DIR, 'ponytail', 'skills', 'ponytail-review'),
    target: join(AGENTS_SKILLS_DIR, 'ponytail-review')
  },
  {
    id: 'ponytail-audit',
    source: join(TOOLS_DIR, 'ponytail', 'skills', 'ponytail-audit'),
    target: join(AGENTS_SKILLS_DIR, 'ponytail-audit')
  }
];

function runCommand(cmd, cwd = PROJECT_ROOT) {
  console.log(`[EXEC] ${cmd} (in ${cwd})`);
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

function forceRemove(targetPath) {
  if (!existsSync(targetPath)) return;
  const makeWritable = (p) => {
    try {
      chmodSync(p, 0o777);
    } catch {}
    try {
      const stats = statSync(p);
      if (stats.isDirectory()) {
        for (const file of readdirSync(p)) {
          makeWritable(join(p, file));
        }
      }
    } catch {}
  };
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    makeWritable(targetPath);
    rmSync(targetPath, { recursive: true, force: true });
  }
}

async function main() {
  console.log('========================================================');
  console.log(' FM-AUTO-OPS Tooling Ecosystem Setup & Clean Vendoring  ');
  console.log('========================================================\n');

  if (!existsSync(TOOLS_DIR)) {
    mkdirSync(TOOLS_DIR, { recursive: true });
  }

  const manifest = {
    schemaVersion: '1.0.0',
    updatedAt: new Date().toISOString(),
    managedBy: 'scripts/setup-tools.mjs',
    tools: []
  };

  // 1. Clone or verify each repository
  for (const repo of REPOSITORIES) {
    console.log(`\n--- Processing [${repo.name}] ---`);
    let commitSha = 'UNKNOWN';

    if (!existsSync(repo.targetDir)) {
      console.log(`Cloning ${repo.url} into ${repo.targetDir}...`);
      runCommand(`git clone --depth 1 ${repo.url} "${repo.targetDir}"`, PROJECT_ROOT);
    } else {
      console.log(`Target directory already exists: ${repo.targetDir}`);
    }

    // Capture commit SHA if .git exists
    const gitDir = join(repo.targetDir, '.git');
    if (existsSync(gitDir)) {
      try {
        commitSha = runCommand('git rev-parse HEAD', repo.targetDir).trim();
        console.log(`Captured HEAD commit: ${commitSha}`);
      } catch (err) {
        console.warn(`Could not read commit SHA for ${repo.name}: ${err.message}`);
      }

      // Strip nested .git folder to enforce clean vendoring and prevent git submodule collisions
      console.log(`Stripping nested .git repository from ${repo.name}...`);
      forceRemove(gitDir);
    } else {
      // If .git already removed, try reading previous manifest entry
      const manifestPath = join(TOOLS_DIR, 'manifest.json');
      if (existsSync(manifestPath)) {
        try {
          const oldManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          const existing = oldManifest.tools?.find(t => t.name === repo.name);
          if (existing?.commit) commitSha = existing.commit;
        } catch {}
      }
    }

    // Strip nested .github/workflows to prevent external workflow contamination
    const nestedWorkflows = join(repo.targetDir, '.github', 'workflows');
    if (existsSync(nestedWorkflows)) {
      console.log(`Stripping nested .github/workflows from ${repo.name}...`);
      forceRemove(nestedWorkflows);
    }

    manifest.tools.push({
      name: repo.name,
      url: repo.url,
      commit: commitSha,
      path: `tools/${repo.name}`,
      description: repo.description,
      setupType: repo.setupType
    });
  }

  // 2. Write tools/manifest.json
  const manifestPath = join(TOOLS_DIR, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\n✓ Generated ${manifestPath}`);

  // 3. Configure environments
  console.log('\n--- Configuring Tool Runtimes ---');

  // ECC npm dependencies
  const eccDir = join(TOOLS_DIR, 'ecc');
  if (existsSync(eccDir)) {
    console.log('\nSetting up ECC runtime (npm install --omit=dev)...');
    try {
      runCommand('npm install --omit=dev', eccDir);
      console.log('✓ ECC dependencies installed successfully.');
    } catch (err) {
      console.error(`Failed to install ECC dependencies: ${err.message}`);
      throw err;
    }
  }

  // Spec-Kit uv environment
  const specKitDir = join(TOOLS_DIR, 'spec-kit');
  if (existsSync(specKitDir)) {
    console.log('\nSetting up Spec-Kit Python environment...');
    try {
      // Run specify --help to auto-sync virtual environment via uv
      runCommand('uv run --project . specify --help', specKitDir);
      console.log('✓ Spec-Kit initialized successfully.');
    } catch (err) {
      console.error(`Failed to initialize Spec-Kit: ${err.message}`);
      throw err;
    }
  }

  // Graphify uv environment
  const graphifyDir = join(TOOLS_DIR, 'graphify');
  if (existsSync(graphifyDir)) {
    console.log('\nSetting up Graphify Python environment...');
    try {
      // Run graphify --help to auto-sync virtual environment via uv
      runCommand('uv run --project . graphify --help', graphifyDir);
      console.log('✓ Graphify initialized successfully.');
    } catch (err) {
      console.error(`Failed to initialize Graphify: ${err.message}`);
      throw err;
    }
  }

  // 4. Deploy agent skills into .agents/skills/
  console.log('\n--- Deploying Core Skills into .agents/skills ---');
  if (!existsSync(AGENTS_SKILLS_DIR)) {
    mkdirSync(AGENTS_SKILLS_DIR, { recursive: true });
  }

  for (const skill of SKILLS_TO_DEPLOY) {
    if (existsSync(skill.source)) {
      if (existsSync(skill.target)) {
        forceRemove(skill.target);
      }
      cpSync(skill.source, skill.target, { recursive: true });
      const skillFile = join(skill.target, 'SKILL.md');
      if (existsSync(skillFile)) {
        console.log(`  ✓ Deployed skill [${skill.id}] -> ${skill.target}`);
      } else {
        console.warn(`  ⚠ Warning: ${skillFile} not found after copy.`);
      }
    } else {
      console.warn(`  ⚠ Source skill not found: ${skill.source}`);
    }
  }

  console.log('\n========================================================');
  console.log(' ✅ Tooling Ecosystem Setup Completed Successfully      ');
  console.log('========================================================\n');
}

main().catch(err => {
  console.error('\n❌ Tooling setup failed:', err);
  process.exit(1);
});
