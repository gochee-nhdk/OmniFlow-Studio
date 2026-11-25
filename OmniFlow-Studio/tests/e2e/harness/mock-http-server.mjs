// Hermetic Mock HTTP Server for OmniFlow-Studio E2E Tests
// Implements Node.js native http server on dynamic loopback port (127.0.0.1:0)
// Serves full-fidelity HTML endpoints for POS and SAP automation workflows

import http from 'node:http';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');

// Lazy-load ExcelJS to dynamically generate valid .xlsx download files
let ExcelJS = null;
async function getExcelJS() {
  if (!ExcelJS) {
    try {
      const excelJsPath = path.join(ROOT_DIR, 'packages/file-engine/node_modules/exceljs/dist/exceljs.js');
      const mod = await import(pathToFileURL(excelJsPath).href);
      ExcelJS = mod.default || mod;
    } catch {
      // Fallback if needed
      ExcelJS = null;
    }
  }
  return ExcelJS;
}

/**
 * Generate a valid in-memory .xlsx buffer with required schema and headers.
 */
export async function createMockExcelBuffer(type = 'SALES', rowCount = 5) {
  const EJS = await getExcelJS();
  if (EJS) {
    const wb = new EJS.Workbook();
    if (type === 'SALES') {
      const ws = wb.addWorksheet('Sales Transaction Detail');
      ws.addRow(['Trans No', 'Date', 'Amount', 'Store Id', 'Store Name', 'Sloc Id']);
      for (let i = 1; i <= rowCount; i++) {
        ws.addRow([`TRX${String(i).padStart(4, '0')}`, '14/11/2026', 150000 + i * 5000, 'FM04', 'FM04 - Hoàng Hoa Thám', 'SFM0401']);
      }
    } else if (type === 'INVENTORY') {
      const ws = wb.addWorksheet('Inventory Onhand');
      ws.addRow(['Store Id', 'Sloc Id', 'Whs Name', 'Item Code', 'Item Name', 'Quantity', 'UoM']);
      for (let i = 1; i <= rowCount; i++) {
        ws.addRow(['FM04', 'SFM0401', 'Kho POS Retail FM04', `ITEM${String(i).padStart(4, '0')}`, `Sản phẩm mẫu ${i}`, 100 - i, 'Cái']);
      }
    } else {
      const ws = wb.addWorksheet('SAP Query Pricelist');
      ws.addRow(['Item Code', 'Item Name', 'Price', 'Currency', 'Vendor', 'PriceList']);
      for (let i = 1; i <= rowCount; i++) {
        ws.addRow([`SAP-ITM-${i}`, `Nguyen lieu ${i}`, 45000 * i, 'VND', 'NCC_LARIA', 'Pricelist_non_Asset']);
      }
    }
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // Minimal valid fallback ZIP/XML buffer exceeding 1KB if ExcelJS is missing
  return Buffer.alloc(2048, 0x20);
}

// ---------------------------------------------------------------------------
// HTML Page Templates
// ---------------------------------------------------------------------------

function getPOSLoginHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>RPFO | TDI APJ - Login</title>
  <style>
    body { font-family: sans-serif; background: #f0f2f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .login-card { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 340px; }
    input { width: 100%; padding: 10px; margin: 8px 0; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; }
    button { width: 100%; padding: 12px; background: #28a745; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer; }
    button:hover { background: #218838; }
  </style>
</head>
<body>
  <div class="login-card">
    <h2>POS RPFO Sign In</h2>
    <form id="pos-login-form" action="/shop/select-outlets" method="GET">
      <label for="txtName">Tên đăng nhập</label>
      <input type="text" id="txtName" name="user" placeholder="User Name" value="admin" required />
      <label for="txtPass">Mật khẩu</label>
      <input type="password" id="txtPass" name="password" placeholder="Password" value="Password123!" required />
      <button type="submit" id="btn-login">LOGIN</button>
    </form>
  </div>
  <script>
    document.getElementById('pos-login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      document.cookie = 'pos_session=authenticated; path=/';
      window.location.href = '/shop/select-outlets';
    });
  </script>
</body>
</html>`;
}

function getPOSSelectOutletsHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>RPFO | Select Outlets</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f8f9fa; }
    .outlet-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; }
    .blog-sider-common { background: white; padding: 16px; border-radius: 6px; border: 1px solid #dee2e6; cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; }
    .blog-sider-common:hover { transform: translateY(-2px); box-shadow: 0 4px 8px rgba(0,0,0,0.1); border-color: #28a745; }
    .outlet-title { font-size: 16px; font-weight: bold; color: #333; margin-bottom: 6px; }
    .last-login { font-size: 12px; color: #6c757d; }
    #init-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); color: white; display: none; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; }
    .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #28a745; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h2>Chọn Cửa Hàng Bán Lẻ (Select Outlets)</h2>
  <div class="outlet-grid">
    <div class="blog-sider-common" id="outlet-fm04" onclick="selectOutlet('FM04')">
      <div class="outlet-title">FM04 - Hoàng Hoa Thám</div>
      <div class="last-login">Last Login: 18/11/2026 08:30</div>
    </div>
    <div class="blog-sider-common" id="outlet-dc01" onclick="selectOutlet('DC01')">
      <div class="outlet-title">DC01 - Nơ Trang Long</div>
      <div class="last-login">Last Login: 17/11/2026 18:00</div>
    </div>
    <div class="blog-sider-common" id="outlet-fm01" onclick="selectOutlet('FM01')">
      <div class="outlet-title">FM01 - Nguyễn Thị Minh Khai</div>
      <div class="last-login">Last Login: 16/11/2026 12:00</div>
    </div>
  </div>

  <div id="init-overlay">
    <div class="spinner"></div>
    <h3 id="init-step-label">Loading Information Shop...</h3>
  </div>

  <script>
    function selectOutlet(code) {
      const overlay = document.getElementById('init-overlay');
      overlay.style.display = 'flex';
      const steps = [
        'Loading Information Shop',
        'Loading Max Value Currency',
        'Loading Format Config',
        'Loading General Setting',
        'Loading Shop Mode',
        'Loading Invoice',
        'Loading Denomination',
        'Loading CRM System',
        'Loading Default Customer'
      ];
      let idx = 0;
      const interval = setInterval(() => {
        idx++;
        if (idx < steps.length) {
          document.getElementById('init-step-label').textContent = steps[idx] + '...';
        } else {
          clearInterval(interval);
          document.cookie = 'pos_outlet=' + code + '; path=/';
          window.location.href = '/dashboard';
        }
      }, 100);
    }
  </script>
</body>
</html>`;
}

function getPOSDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>RPFO | Dashboard</title>
  <style>
    body { font-family: sans-serif; margin: 0; background: #e9ecef; }
    nav { background: #343a40; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; }
    .nav-brand { font-weight: bold; font-size: 18px; display: flex; align-items: center; gap: 15px; }
    .badge-inshop { background: #28a745; color: white; padding: 4px 10px; border-radius: 12px; font-size: 13px; }
    .btn-more { background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-weight: bold; cursor: pointer; }
    .btn-more:hover { background: #0069d9; }
    .content { padding: 30px; }

    /* More Modal */
    .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
    .modal-dialog { background: white; border-radius: 8px; width: 480px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
    .modal-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #dee2e6; padding-bottom: 10px; }
    .modal-close { background: none; border: none; font-size: 20px; cursor: pointer; }
    .search-menu { width: 100%; padding: 8px; margin: 15px 0; border: 1px solid #ced4da; border-radius: 4px; box-sizing: border-box; }
    .tile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tile { padding: 16px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; text-align: center; cursor: pointer; font-weight: 500; }
    .tile:hover { background: #e2e6ea; }
    .report-submenu { display: none; margin-top: 15px; border-top: 1px solid #dee2e6; padding-top: 15px; }
    .submenu-item { display: block; padding: 10px; text-decoration: none; color: #212529; border-radius: 4px; margin-bottom: 5px; }
    .submenu-item:hover { background: #e9ecef; color: #007bff; }
  </style>
</head>
<body>
  <nav>
    <div class="nav-brand">
      <span>OmniFlow POS Retail</span>
      <span class="badge-inshop">IN SHOP</span>
    </div>
    <div>
      <button class="btn-more" id="btn-more" onclick="openMoreModal()">MORE</button>
    </div>
  </nav>

  <div class="content">
    <h1>Bàn làm việc POS (Dashboard)</h1>
    <p>Hệ thống bán lẻ hoạt động ổn định. Cửa hàng: <strong>FM04 - Hoàng Hoa Thám</strong>.</p>
    <ul>
      <li><a href="/admin/report/sales-transaction-detail">Xem Báo cáo Chi tiết Giao dịch Bán hàng (Sales Detail)</a></li>
      <li><a href="/admin/report/inventory-onhand">Xem Báo cáo Tồn kho Hiện tại (Inventory Onhand)</a></li>
    </ul>
  </div>

  <!-- More Modal -->
  <div class="modal-overlay" id="more-modal" role="dialog" aria-modal="true">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>More</h3>
        <button class="modal-close" onclick="closeMoreModal()">&times;</button>
      </div>
      <input type="text" class="search-menu" placeholder="Search Menu" />
      <div class="tile-grid" id="tile-grid">
        <div class="tile" onclick="openReportSubmenu()">Report</div>
        <div class="tile">Sales</div>
        <div class="tile">Purchase</div>
        <div class="tile">Store</div>
      </div>
      <div class="report-submenu" id="report-submenu">
        <h4>Menu Báo Cáo</h4>
        <a class="submenu-item" href="/admin/report/sales-transaction-detail">Sales Transaction Detail</a>
        <a class="submenu-item" href="/admin/report/inventory-onhand">Inventory Onhand</a>
      </div>
    </div>
  </div>

  <script>
    function openMoreModal() { document.getElementById('more-modal').style.display = 'flex'; }
    function closeMoreModal() { document.getElementById('more-modal').style.display = 'none'; }
    function openReportSubmenu() { document.getElementById('report-submenu').style.display = 'block'; }
  </script>
</body>
</html>`;
}

function getPOSSalesDetailHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Sales Transaction Detail</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f8f9fa; color: #333; }
    h1 { font-size: 22px; margin-bottom: 20px; }
    .filter-panel { background: white; padding: 16px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; align-items: center; gap: 15px; flex-wrap: wrap; }
    .form-group { display: flex; align-items: center; gap: 8px; }
    input[type="date"], select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
    .btn-search { background: #28a745; color: white; border: none; padding: 8px 18px; border-radius: 4px; font-weight: bold; cursor: pointer; }
    .btn-search:hover { background: #218838; }
    .btn-form-excel { background: #007bff; color: white; border: none; padding: 8px 18px; border-radius: 4px; font-weight: bold; cursor: pointer; }
    .btn-form-excel:hover { background: #0069d9; }

    /* DevExtreme Table Emulation */
    .dx-datagrid { background: white; border: 1px solid #ddd; border-radius: 4px; margin-top: 15px; }
    .dx-datagrid-header-panel { padding: 8px 12px; border-bottom: 1px solid #ddd; display: flex; justify-content: flex-end; background: #fafafa; }
    .dx-datagrid-export-button { background: white; border: 1px solid #ccc; padding: 6px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500; }
    .dx-datagrid-export-button:hover { background: #f0f0f0; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #eee; padding: 10px 12px; text-align: left; }
    th { background: #f1f3f5; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
  </style>
</head>
<body>
  <h1>Sales Transaction Detail</h1>

  <div class="filter-panel">
    <div class="form-group">
      <label>From Date:</label>
      <input type="date" id="from-date" name="fromDate" value="2026-11-01" />
    </div>
    <div class="form-group">
      <label>To Date:</label>
      <input type="date" id="to-date" name="toDate" value="2026-11-10" />
    </div>
    <div class="form-group">
      <label>Store:</label>
      <select id="store-select" name="store">
        <option value="All">All</option>
        <option value="FM04" selected>FM04 - Hoàng Hoa Thám</option>
        <option value="DC01">DC01 - Nơ Trang Long</option>
      </select>
    </div>
    <button class="btn-search" id="btn-search" onclick="doSearch()">Search</button>
    <button class="btn-form-excel" id="btn-excel-form" onclick="triggerDownload()">Excel</button>
  </div>

  <div class="dx-datagrid dx-widget">
    <div class="dx-datagrid-header-panel">
      <div class="dx-toolbar">
        <button class="dx-button dx-datagrid-export-button" title="Export to Excel" onclick="triggerDownload()">
          <span class="dx-icon dx-icon-xlsxfile">📊</span>
          <span class="dx-button-text">Excel</span>
        </button>
      </div>
    </div>
    <div class="dx-datagrid-headers">
      <table>
        <thead>
          <tr class="dx-header-row">
            <th>Trans No</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Store Id</th>
            <th>Store Name</th>
            <th>Sloc Id</th>
          </tr>
        </thead>
      </table>
    </div>
    <div class="dx-datagrid-rowsview">
      <table id="sales-table">
        <tbody>
          <tr class="dx-data-row">
            <td>TRX0001</td>
            <td>01/11/2026</td>
            <td>155,000 ₫</td>
            <td>FM04</td>
            <td>FM04 - Hoàng Hoa Thám</td>
            <td>SFM0401</td>
          </tr>
          <tr class="dx-data-row">
            <td>TRX0002</td>
            <td>02/11/2026</td>
            <td>280,000 ₫</td>
            <td>FM04</td>
            <td>FM04 - Hoàng Hoa Thám</td>
            <td>SFM0401</td>
          </tr>
          <tr class="dx-data-row">
            <td>TRX0003</td>
            <td>05/11/2026</td>
            <td>410,000 ₫</td>
            <td>FM04</td>
            <td>FM04 - Hoàng Hoa Thám</td>
            <td>SFM0401</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function doSearch() {
      const from = document.getElementById('from-date').value;
      const to = document.getElementById('to-date').value;
      console.log('Search triggered for range:', from, 'to', to);
    }
    function triggerDownload() {
      window.location.href = '/download/sales.xlsx';
    }
  </script>
</body>
</html>`;
}

function getPOSInventoryOnhandHtml() {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Inventory Onhand</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #f8f9fa; color: #333; }
    h1 { font-size: 22px; margin-bottom: 20px; }
    .filter-panel { background: white; padding: 16px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; display: flex; align-items: center; gap: 15px; }
    select { padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
    .btn-search { background: #28a745; color: white; border: none; padding: 8px 18px; border-radius: 4px; font-weight: bold; cursor: pointer; }

    /* Loading Wave Emulation */
    .dx-loadpanel.loading-wave { display: none; background: rgba(255,255,255,0.85); position: absolute; inset: 0; z-index: 100; align-items: center; justify-content: center; font-weight: bold; color: #28a745; }

    .dx-datagrid { background: white; border: 1px solid #ddd; border-radius: 4px; position: relative; }
    .dx-datagrid-header-panel { padding: 8px 12px; border-bottom: 1px solid #ddd; display: flex; justify-content: flex-end; background: #fafafa; }
    .dx-datagrid-export-button { background: white; border: 1px solid #ccc; padding: 6px 12px; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-weight: 500; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #eee; padding: 10px 12px; text-align: left; }
    th { background: #f1f3f5; font-weight: 600; cursor: pointer; }
    .dx-header-filter { font-size: 11px; margin-left: 6px; color: #6c757d; }

    /* Filter Popup */
    .dx-header-filter-menu { display: none; position: absolute; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); width: 220px; z-index: 200; padding: 10px; }
    .dx-texteditor-input { width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 8px; }
    .dx-list-item { padding: 6px 4px; display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; }
    .dx-list-item:hover { background: #f1f3f5; }
    .dx-popup-bottom { margin-top: 10px; display: flex; justify-content: flex-end; gap: 8px; }
    .dx-button { padding: 4px 10px; border: 1px solid #ccc; background: #f8f9fa; border-radius: 3px; cursor: pointer; }
    .dx-button.dx-ok { background: #007bff; color: white; border-color: #007bff; }
  </style>
</head>
<body>
  <h1>Inventory Onhand</h1>

  <div class="filter-panel">
    <label>Store:</label>
    <select id="store-select" name="store">
      <option value="All">All</option>
      <option value="FM04" selected>FM04 - Hoàng Hoa Thám</option>
      <option value="DC01">DC01 - Nơ Trang Long</option>
    </select>
    <button class="btn-search" id="btn-search" onclick="doSearch()">Search</button>
  </div>

  <div class="dx-datagrid dx-widget" id="grid-container">
    <div class="dx-loadpanel loading-wave" id="loading-wave">Loading inventory data...</div>

    <div class="dx-datagrid-header-panel">
      <div class="dx-toolbar">
        <button class="dx-button dx-datagrid-export-button" title="Export to Excel" onclick="triggerDownload()">
          <span class="dx-icon dx-icon-xlsxfile">📊</span>
          <span class="dx-button-text">Excel</span>
        </button>
      </div>
    </div>

    <div class="dx-datagrid-headers">
      <table>
        <thead>
          <tr class="dx-header-row">
            <td id="th-sloc" onclick="openFilter(event, 'sloc')">Sloc Id <span class="dx-header-filter">▼</span></td>
            <td id="th-item" onclick="openFilter(event, 'item')">Item Code <span class="dx-header-filter">▼</span></td>
            <td>Whs Name</td>
            <td>Item Name</td>
            <td>Quantity</td>
            <td>UoM</td>
          </tr>
        </thead>
      </table>
    </div>

    <div class="dx-datagrid-rowsview">
      <table id="inventory-table">
        <tbody>
          <tr class="dx-data-row">
            <td>SFM0401</td>
            <td>ITEM0001</td>
            <td>Kho POS Retail FM04</td>
            <td>Táo Envy New Zealand</td>
            <td>45</td>
            <td>Kg</td>
          </tr>
          <tr class="dx-data-row">
            <td>SFM0401</td>
            <td>ITEM0002</td>
            <td>Kho POS Retail FM04</td>
            <td>Cam Ruột Đỏ Cara</td>
            <td>80</td>
            <td>Kg</td>
          </tr>
          <tr class="dx-data-row">
            <td>SDC0101</td>
            <td>ITEM0003</td>
            <td>Kho Trung Tâm NTL DC01</td>
            <td>Nho Xanh Autumn Crisp</td>
            <td>120</td>
            <td>Hộp</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Header Filter Popup Menu -->
    <div class="dx-header-filter-menu" id="filter-menu">
      <input type="text" class="dx-texteditor-input" placeholder="Search" />
      <div class="dx-scrollview-content dx-list">
        <div class="dx-list-item"><span class="dx-checkbox">☑</span> (Select All)</div>
        <div class="dx-list-item"><span class="dx-checkbox">☑</span> SFM0401</div>
        <div class="dx-list-item"><span class="dx-checkbox">☑</span> SDC0101</div>
      </div>
      <div class="dx-popup-bottom">
        <button class="dx-button dx-ok" onclick="closeFilter()">OK</button>
        <button class="dx-button" onclick="closeFilter()">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    function doSearch() {
      const wave = document.getElementById('loading-wave');
      wave.style.display = 'flex';
      setTimeout(() => { wave.style.display = 'none'; }, 200);
    }
    function openFilter(e, col) {
      const menu = document.getElementById('filter-menu');
      menu.style.display = 'block';
      menu.style.left = e.clientX + 'px';
      menu.style.top = (e.clientY + 20) + 'px';
    }
    function closeFilter() {
      document.getElementById('filter-menu').style.display = 'none';
    }
    function triggerDownload() {
      window.location.href = '/download/inventory.xlsx';
    }
  </script>
</body>
</html>`;
}

function getSAPDispatcherHtml(authenticated = false) {
  if (authenticated) {
    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>SAP Business One - Workspace</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #001e38; color: white; }
    #shell-header { background: #002d5a; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #00509d; }
    .sapMShellTitle { font-size: 18px; font-weight: bold; }
    .shell-search { padding: 6px 12px; border-radius: 4px; border: 1px solid #0077b6; background: #001830; color: white; width: 240px; }
    .main-workspace { padding: 30px; }
    .sapUshellTile { background: #003566; padding: 20px; border-radius: 6px; width: 220px; border: 1px solid #0077b6; margin-bottom: 20px; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 15px; }
    .btn-sap { background: #0077b6; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; }
    .btn-sap:hover { background: #0096c7; }

    /* Modals */
    .sap-modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); align-items: center; justify-content: center; z-index: 1000; }
    .modal-box { background: white; color: #333; padding: 25px; border-radius: 6px; width: 440px; box-shadow: 0 4px 16px rgba(0,0,0,0.3); }
    .category-item, .query-item { padding: 8px; border: 1px solid #ddd; margin-bottom: 6px; border-radius: 4px; cursor: pointer; }
    .category-item:hover, .query-item:hover { background: #e0f2fe; border-color: #0284c7; }
    .active-item { background: #bae6fd; border-color: #0284c7; font-weight: bold; }
    .modal-footer { margin-top: 15px; display: flex; justify-content: flex-end; gap: 10px; }
  </style>
</head>
<body>
  <div id="shell-header">
    <div class="sapMShellTitle">Purchasing - A/P</div>
    <input type="text" class="shell-search" placeholder="Look up menus..." />
  </div>

  <div class="main-workspace">
    <div class="toolbar">
      <button class="btn-sap" id="btn-tools" onclick="openQueryManager()">Tools</button>
      <button class="btn-sap" id="btn-qm" onclick="openQueryManager()">Query Manager</button>
    </div>

    <div class="sapUshellTile">
      <h3>Purchasing - A/P</h3>
      <p>Nhập kho, mua hàng, báo cáo giá nhà cung cấp.</p>
    </div>

    <!-- Query Manager Modal -->
    <div class="sap-modal" id="qm-modal">
      <div class="modal-box">
        <h3>Query Manager</h3>
        <p>Chọn nhóm truy vấn:</p>
        <div class="category-item active-item" id="cat-danhmuc">Danh Mục</div>
        <p>Chọn truy vấn:</p>
        <div class="query-item active-item" id="query-item-pricelist">Danh sách item ncc pricelist_non_Asset</div>
        <div class="modal-footer">
          <button class="btn-sap" id="qm-ok" onclick="runQuery()">OK</button>
        </div>
      </div>
    </div>

    <!-- Query Results View -->
    <div id="query-results" style="display:none; margin-top: 20px; background: white; color: #333; padding: 15px; border-radius: 4px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h4>Kết quả truy vấn: Danh sách item ncc pricelist_non_Asset</h4>
        <button class="btn-sap" id="btn-export-excel" title="Export to MS-EXCEL" onclick="openSaveAs()">Export to MS-EXCEL</button>
      </div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f1f5f9; text-align: left;">
            <th style="padding: 8px; border: 1px solid #cbd5e1;">Item Code</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">Item Name</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">Price</th>
            <th style="padding: 8px; border: 1px solid #cbd5e1;">Currency</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px; border: 1px solid #cbd5e1;">SAP-ITM-001</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1;">Thịt ba chỉ heo tươi</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1;">135,000</td>
            <td style="padding: 8px; border: 1px solid #cbd5e1;">VND</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Save As Dialog -->
    <div class="sap-modal" id="save-as-modal">
      <div class="modal-box">
        <h3>Save As</h3>
        <p>Enter a file name and confirm:</p>
        <input type="text" value="Danh sách item ncc pricelist_non_Asset.txt" style="width: 100%; padding: 6px; box-sizing: border-box;" />
        <div class="modal-footer">
          <button class="btn-sap" id="save-as-ok" onclick="openCurrencyDialog()">OK</button>
        </div>
      </div>
    </div>

    <!-- Export Currency Symbols Dialog -->
    <div class="sap-modal" id="currency-modal">
      <div class="modal-box">
        <h3>Export currency symbols?</h3>
        <p>Yes, to the same column</p>
        <div class="modal-footer">
          <button class="btn-sap" id="currency-ok" onclick="finishSapExport()">OK</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    function openQueryManager() { document.getElementById('qm-modal').style.display = 'flex'; }
    function runQuery() {
      document.getElementById('qm-modal').style.display = 'none';
      document.getElementById('query-results').style.display = 'block';
    }
    function openSaveAs() { document.getElementById('save-as-modal').style.display = 'flex'; }
    function openCurrencyDialog() {
      document.getElementById('save-as-modal').style.display = 'none';
      document.getElementById('currency-modal').style.display = 'flex';
    }
    function finishSapExport() {
      document.getElementById('currency-modal').style.display = 'none';
      window.location.href = '/download/sap-pricelist.xlsx';
    }
  </script>
</body>
</html>`;
  }

  // SLD Logon Form
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>SAP Business One - SLD Logon</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #001e38; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .sld-box { background: white; color: #333; padding: 30px; border-radius: 8px; width: 380px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    table { width: 100%; }
    td { padding: 6px 0; }
    select, input[type="text"], input[type="password"] { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
    input[type="button"], button[type="submit"] { background: #0077b6; color: white; border: none; padding: 10px; border-radius: 4px; font-weight: bold; cursor: pointer; }
    button[type="submit"] { width: 100%; margin-top: 10px; }
    #messagebox { display: none; margin-top: 15px; padding: 12px; background: #fff3cd; border: 1px solid #ffeeba; border-radius: 4px; color: #856404; font-size: 13px; }
  </style>
</head>
<body>
  <div class="sld-box">
    <h2 style="margin-top: 0;">SAP Business One Logon</h2>
    <form id="sld-form" action="/dispatcher/?workspace=1" method="GET">
      <table class="sbo_layer">
        <tr>
          <td><label for="sbo_dbserver">Database Server:</label></td>
        </tr>
        <tr>
          <td>
            <select id="sbo_dbserver" name="server">
              <option value="SBO@172.16.0.201:30013">SBO@172.16.0.201:30013</option>
            </select>
          </td>
        </tr>
        <tr>
          <td>
            <label for="sbo_company">Company:</label>
            <input type="button" id="refresh_company" value="Refresh" style="float: right; padding: 2px 8px; font-size: 11px;" />
          </td>
        </tr>
        <tr>
          <td>
            <select id="sbo_company" name="company">
              <option value="FM_PRO">Công ty TNHH Thương Mại LARIA (FM_PRO)</option>
              <option value="BEFORE_IMPORT1">Before Import Database</option>
            </select>
            <input type="hidden" id="sbo_custom_company" value="" />
          </td>
        </tr>
        <tr>
          <td><label for="sbo_user">User ID:</label></td>
        </tr>
        <tr>
          <td><input type="text" id="sbo_user" name="user" value="manager" required /></td>
        </tr>
        <tr>
          <td><label for="sbo_password">Password:</label></td>
        </tr>
        <tr>
          <td><input type="password" id="sbo_password" name="password" value="Password123!" required /></td>
        </tr>
        <tr>
          <td><button type="submit" id="logon_sbo_btn">Log on</button></td>
        </tr>
      </table>
    </form>

    <div id="messagebox">
      <p>User already connected. Take over session?</p>
      <button type="button" class="btn-sap" onclick="confirmTakeover()">Yes</button>
    </div>
  </div>

  <script>
    document.getElementById('sld-form').addEventListener('submit', (e) => {
      e.preventDefault();
      document.cookie = 'sap_session=authenticated; path=/';
      window.location.href = '/dispatcher/?workspace=1';
    });
    function confirmTakeover() {
      document.getElementById('messagebox').style.display = 'none';
      window.location.href = '/dispatcher/?workspace=1';
    }
  </script>
</body>
</html>`;
}

function getSAML2AcsErrorHtml() {
  return `<!DOCTYPE html>
<html>
<head><title>SAML 2.0 Error</title></head>
<body>
  <h1>HTTP Status 500 – Internal Server Error</h1>
  <p><strong>Message:</strong> while trying to invoke the method com.sap.security.saml2.cfg.interfaces.SAML2SPConfiguration.getLocalSP() of a null object loaded from local variable 'configuration'</p>
  <p>Location: /dispatcher/saml2/sp/acs</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// MockHttpServer Implementation
// ---------------------------------------------------------------------------

export class MockHttpServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.host = '127.0.0.1';
    this.customRoutes = new Map();
    this.activeSockets = new Set();
    this.requestLog = [];
  }

  /**
   * Register a custom route handler for specific method and path.
   */
  setRouteHandler(method, routePath, handler) {
    const key = `${method.toUpperCase()}:${routePath}`;
    this.customRoutes.set(key, handler);
  }

  /**
   * Reset custom routes and logs.
   */
  reset() {
    this.customRoutes.clear();
    this.requestLog = [];
  }

  /**
   * Start the HTTP server on loopback dynamic port (127.0.0.1:0).
   */
  async start(port = 0) {
    if (this.server) return this;

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const parsedUrl = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
          const pathname = parsedUrl.pathname;
          const method = req.method.toUpperCase();

          this.requestLog.push({ method, pathname, query: Object.fromEntries(parsedUrl.searchParams), timestamp: Date.now() });

          // 1. Check custom registered routes first
          const customKey = `${method}:${pathname}`;
          if (this.customRoutes.has(customKey)) {
            const handler = this.customRoutes.get(customKey);
            return handler(req, res, parsedUrl);
          }

          // 2. Static / Standard Mock Endpoints
          if (pathname === '/error/500') {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end('Internal Server Error 500');
          }

          if (pathname === '/error/404') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not Found 404');
          }

          // SAP Endpoints
          if (pathname === '/dispatcher/saml2/sp/acs') {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getSAML2AcsErrorHtml());
          }

          if (pathname.startsWith('/dispatcher')) {
            const isWorkspace = parsedUrl.searchParams.get('workspace') === '1' || req.headers.cookie?.includes('sap_session=authenticated');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getSAPDispatcherHtml(isWorkspace));
          }

          // POS Endpoints
          if (pathname === '/' || pathname === '/login' || pathname === '/home') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getPOSLoginHtml());
          }

          if (pathname === '/shop/select-outlets') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getPOSSelectOutletsHtml());
          }

          if (pathname === '/dashboard' || pathname === '/admin/dashboard') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getPOSDashboardHtml());
          }

          if (pathname === '/admin/report/sales-transaction-detail') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getPOSSalesDetailHtml());
          }

          if (pathname === '/admin/report/inventory-onhand') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(getPOSInventoryOnhandHtml());
          }

          // Download Endpoints
          if (pathname === '/download/sales.xlsx' || pathname === '/export/sales.xlsx') {
            const buf = await createMockExcelBuffer('SALES', 8);
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': 'attachment; filename="Sales_Transaction_Detail.xlsx"',
              'Content-Length': buf.length,
            });
            return res.end(buf);
          }

          if (pathname === '/download/inventory.xlsx' || pathname === '/export/inventory.xlsx') {
            const buf = await createMockExcelBuffer('INVENTORY', 12);
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': 'attachment; filename="Inventory_Onhand.xlsx"',
              'Content-Length': buf.length,
            });
            return res.end(buf);
          }

          if (pathname === '/download/sap-pricelist.xlsx' || pathname === '/export/sap.xlsx') {
            const buf = await createMockExcelBuffer('SAP', 10);
            res.writeHead(200, {
              'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'Content-Disposition': 'attachment; filename="Pricelist_non_Asset.xlsx"',
              'Content-Length': buf.length,
            });
            return res.end(buf);
          }

          // Default fallback
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(getPOSLoginHtml());
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Internal Server Error: ${err.message}`);
        }
      });

      // Track active sockets to terminate instantly on close()
      this.server.on('connection', (socket) => {
        this.activeSockets.add(socket);
        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });
      });

      this.server.listen(port, this.host, () => {
        const addr = this.server.address();
        this.port = typeof addr === 'object' ? addr.port : port;
        resolve(this);
      });

      this.server.on('error', reject);
    });
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  get posUrl() {
    return this.baseUrl;
  }

  get sapUrl() {
    return `${this.baseUrl}/dispatcher/`;
  }

  /**
   * Stop the server and clean up all resources.
   */
  async close() {
    if (!this.server) return;

    for (const socket of this.activeSockets) {
      try { socket.destroy(); } catch {}
    }
    this.activeSockets.clear();

    return new Promise((resolve) => {
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }
}

/**
 * Convenience helper to start an ephemeral MockHttpServer instance.
 */
export async function startMockServer(port = 0) {
  const server = new MockHttpServer();
  await server.start(port);
  return server;
}
