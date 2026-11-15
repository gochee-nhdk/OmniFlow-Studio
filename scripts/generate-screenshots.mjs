import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const { chromium } = require('d:/tool auto/OmniFlow-Studio/node_modules/.pnpm/playwright@1.65.0/node_modules/playwright');

const OUT_DIR_1 = path.resolve('docs/screenshots');
const OUT_DIR_2 = path.resolve('OmniFlow-Studio/docs/screenshots');

[OUT_DIR_1, OUT_DIR_2].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

async function capture() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--force-device-scale-factor=2', '--no-sandbox']
  });
  
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });

  const page = await context.newPage();

  // Inject sanitized mock localStorage profiles before loading
  await page.addInitScript(() => {
    const mockProfiles = [
      {
        id: 'profile-acme-global',
        name: 'ACME Global Retail Corp',
        code: 'ACME_ERP',
        erpType: 'SAP_B1',
        erpUrl: 'https://erp.enterprise.example.com:8100/dispatcher/',
        server: 'SBO@sap-cluster.enterprise.example.com:30013',
        database: 'ACME_PROD',
        companyName: 'ACME Global Retail Corp (ACME_ERP)',
        companySchema: 'ACME_ERP',
        namingTemplate: '{{orgCode}}_{{reportType}}_{{fromDate}}_{{toDate}}.xlsx',
        exportPath: 'D:\\OmniFlow_Reports',
        isActive: true,
        storeMappings: [
          { id: 'ST01', name: 'Flagship Store 01 (Central Retail)' },
          { id: 'ST02', name: 'Downtown Branch Store 02' },
          { id: 'ST03', name: 'West End Mall Store 03' },
          { id: 'ST04', name: 'Harbor Gateway Store 04' },
          { id: 'ST05', name: 'Airport Express Store 05' },
        ],
        slocMappings: [
          { id: 'DC01', name: 'Primary Distribution Center (DC-01)' },
          { id: 'DC02', name: 'Regional Hub Warehouse (DC-02)' },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-11-15T00:00:00.000Z',
      },
      {
        id: 'profile-odoo-demo',
        name: 'Standard Enterprise Retail',
        code: 'STANDARD_ERP',
        erpType: 'ODOO',
        erpUrl: 'https://erp.global-retail.example.com',
        server: 'odoo-prod-cluster-01',
        database: 'global_retail_db',
        companyName: 'Standard Enterprise Retail Group',
        companySchema: 'public',
        namingTemplate: '{{orgCode}}_{{reportType}}_{{timestamp}}.xlsx',
        exportPath: 'D:\\OmniFlow_Reports\\Odoo',
        isActive: false,
        storeMappings: [
          { id: 'WH01', name: 'Central Warehouse Berlin' },
          { id: 'STR01', name: 'Flagship Store Tokyo' },
        ],
        slocMappings: [
          { id: 'MAIN', name: 'Main Stock Location' },
          { id: 'TRANSIT', name: 'In-Transit Storage' },
        ],
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-11-15T00:00:00.000Z',
      }
    ];
    localStorage.setItem('omniflow_enterprise_profiles', JSON.stringify(mockProfiles));
    localStorage.setItem('omniflow_active_enterprise_id', 'profile-acme-global');
  });

  // 1. Dashboard (SAP View)
  console.log('Navigating to Dashboard...');
  await page.goto('http://localhost:5173/#/dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const sapDashBuf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT_DIR_1, 'dashboard-sap.png'), sapDashBuf);
  fs.writeFileSync(path.join(OUT_DIR_2, 'dashboard-sap.png'), sapDashBuf);
  console.log('Saved dashboard-sap.png');

  // 2. POS Automation Page
  console.log('Navigating to POS Page...');
  await page.goto('http://localhost:5173/#/pos', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const posBuf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT_DIR_1, 'pos-automation.png'), posBuf);
  fs.writeFileSync(path.join(OUT_DIR_2, 'pos-automation.png'), posBuf);
  console.log('Saved pos-automation.png');

  // 3. Network Infrastructure Monitor (in Settings -> Network tab)
  console.log('Navigating to Settings -> Network tab...');
  await page.goto('http://localhost:5173/#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const networkTabBtn = page.locator('button', { hasText: 'Hạ tầng mạng' });
  if (await networkTabBtn.count() > 0) {
    await networkTabBtn.first().click();
    await page.waitForTimeout(800);
  }
  const netBuf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT_DIR_1, 'network-infrastructure.png'), netBuf);
  fs.writeFileSync(path.join(OUT_DIR_2, 'network-infrastructure.png'), netBuf);
  console.log('Saved network-infrastructure.png');

  // 4. Enterprise Profiles Modal
  console.log('Opening Enterprise Profiles Modal...');
  await page.goto('http://localhost:5173/#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const enterpriseTabBtn = page.locator('button', { hasText: 'Hồ sơ Đa Doanh nghiệp' });
  if (await enterpriseTabBtn.count() > 0) {
    await enterpriseTabBtn.first().click();
    await page.waitForTimeout(600);
  }
  const openModalBtn = page.locator('button', { hasText: 'Quản lý' });
  if (await openModalBtn.count() > 0) {
    await openModalBtn.first().click();
    await page.waitForTimeout(800);
  }
  const entBuf = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(OUT_DIR_1, 'enterprise-profiles.png'), entBuf);
  fs.writeFileSync(path.join(OUT_DIR_2, 'enterprise-profiles.png'), entBuf);
  console.log('Saved enterprise-profiles.png');

  await browser.close();
  console.log('All high-resolution sanitized screenshots generated successfully!');
}

capture().catch(err => {
  console.error(err);
  process.exit(1);
});
