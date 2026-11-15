import { mkdirSync, existsSync, accessSync, constants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REPORT_ROOT = join(homedir(), 'Documents', 'OmniFlow_Reports');
const DIRS = ['Inventory', 'Sales', 'SAP', 'PO', 'Return', 'Archive', 'Error', 'Logs', 'Temp'];

console.log('FM AUTO OPS — Initializing Directory Structure...\n');

if (!existsSync(REPORT_ROOT)) {
  mkdirSync(REPORT_ROOT, { recursive: true });
  console.log(`✓ Created root directory: ${REPORT_ROOT}`);
} else {
  console.log(`✓ Root directory exists: ${REPORT_ROOT}`);
}

for (const dir of DIRS) {
  const fullPath = join(REPORT_ROOT, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    console.log(`  ✓ Created subfolder: ${fullPath}`);
  } else {
    console.log(`  · Exists: ${fullPath}`);
  }
}

try {
  accessSync(REPORT_ROOT, constants.W_OK);
  console.log('\n✓ Write permission verified on ' + REPORT_ROOT);
} catch {
  console.error('\n✗ Error: No write permission on ' + REPORT_ROOT);
  process.exit(1);
}

console.log('\n✅ FM AUTO OPS directory structure initialized successfully.');
