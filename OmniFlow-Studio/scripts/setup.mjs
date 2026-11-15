import { mkdirSync, existsSync, accessSync, constants } from 'fs';
import { join } from 'path';

const FM_ROOT = 'D:\\FM_AUTO_OPS';
const DIRS = ['Inventory', 'Sales', 'SAP', 'PO', 'Return', 'Archive', 'Error', 'Logs', 'Temp'];

console.log('FM AUTO OPS — Initializing Directory Structure...\n');

if (!existsSync(FM_ROOT)) {
  mkdirSync(FM_ROOT, { recursive: true });
  console.log(`✓ Created root directory: ${FM_ROOT}`);
} else {
  console.log(`✓ Root directory exists: ${FM_ROOT}`);
}

for (const dir of DIRS) {
  const fullPath = join(FM_ROOT, dir);
  if (!existsSync(fullPath)) {
    mkdirSync(fullPath, { recursive: true });
    console.log(`  ✓ Created subfolder: ${fullPath}`);
  } else {
    console.log(`  · Exists: ${fullPath}`);
  }
}

try {
  accessSync(FM_ROOT, constants.W_OK);
  console.log('\n✓ Write permission verified on ' + FM_ROOT);
} catch {
  console.error('\n✗ Error: No write permission on ' + FM_ROOT);
  process.exit(1);
}

console.log('\n✅ FM AUTO OPS directory structure initialized successfully.');
