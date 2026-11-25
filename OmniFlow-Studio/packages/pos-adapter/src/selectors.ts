// FM AUTO OPS — POS RPFO Selector Registry
// Verified against live video recording: RPFO | TDI APJ (http://172.16.1.200)

export interface SelectorConfig {
  primary: string;
  fallback: string;
  timeout: number;
  description: string;
  verified: boolean;
  notes?: string;
}

/**
 * Complete list of 16 standard Sloc IDs verified from POS RPFO Inventory Onhand video (03:08 - 04:08):
 * - 3 Central Warehouse Slocs: SDC0101, SDC0107, SDC0201
 * - 1 Farmers Fruits & Gifts Sloc: SFF0101
 * - 12 Retail Store Slocs: SFM0101 .. SFM1201 (including SFM06QT1, SFM07AP1)
 */
export const DEFAULT_FARMERS_MARKET_SLOCS: Array<{ id: string; name: string }> = [
  { id: 'SDC0101', name: 'Kho Trung Tâm NTL DC01' },
  { id: 'SDC0107', name: 'Kho Trung Tâm NTL DC01 (07)' },
  { id: 'SDC0201', name: 'Kho Trung Tâm Thủ Đức DC02' },
  { id: 'SFF0101', name: 'Kho POS Retail FF01 - Thảo Điền' },
  { id: 'SFM0101', name: 'Kho POS Retail FM01 - Nguyễn Thị Minh Khai' },
  { id: 'SFM0201', name: 'Kho POS Retail FM02 - Phan Xích Long' },
  { id: 'SFM0301', name: 'Kho POS Retail FM03 - Nguyễn Thị Thập' },
  { id: 'SFM0401', name: 'Kho POS Retail FM04 - Hoàng Hoa Thám' },
  { id: 'SFM0501', name: 'Kho POS Retail FM05 - Hai Bà Trưng' },
  { id: 'SFM06QT1', name: 'Kho POS Retail FM06QT - Quang Trung' },
  { id: 'SFM07AP1', name: 'Kho POS Retail FM07 - An Phú' },
  { id: 'SFM0801', name: 'Kho POS Retail FM08 - Sư Vạn Hạnh' },
  { id: 'SFM0901', name: 'Kho POS Retail FM09 - Vinhomes Grand Park' },
  { id: 'SFM1001', name: 'Kho POS Retail FM10' },
  { id: 'SFM1101', name: 'Kho POS Retail FM11' },
  { id: 'SFM1201', name: 'Kho POS Retail FM12' },
];

export const DEFAULT_FARMERS_MARKET_STORES: Array<{ id: string; name: string }> = [
  { id: 'DC01', name: 'DC01 - Nơ Trang Long' },
  { id: 'DC02', name: 'DC02 - Thủ Đức' },
  { id: 'EC02', name: 'Online GHTQ' },
  { id: 'FF01', name: 'FF01 - Farmers Fruits & Gifts - 31 Thảo Điền' },
  { id: 'FM01', name: 'FM01 - Nguyễn Thị Minh Khai' },
  { id: 'FM02', name: 'FM02 - Phan Xích Long' },
  { id: 'FM03', name: 'FM03 - Nguyễn Thị Thập' },
  { id: 'FM04', name: 'FM04 - Hoàng Hoa Thám' },
  { id: 'FM05', name: 'FM05 - Hai Bà Trưng' },
  { id: 'FM06QT', name: 'FM06QT - Quang Trung' },
  { id: 'FM07AP', name: 'FM07 - An Phú' },
  { id: 'FM08', name: 'FM08 - Sư Vạn Hạnh' },
  { id: 'FM09', name: 'FM09 - Vinhomes Grand Park S10.01' },
];

export const POS_SELECTORS = {
  dashboard: {
    pageIndicator: {
      primary: 'text=IN SHOP',
      fallback: '[title="IN SHOP"], header:has-text("IN SHOP"), :text("BILL SEARCH"), :text("STOCK CHECK")',
      timeout: 15000,
      description: 'Confirms POS dashboard loaded and authenticated — "IN SHOP" text visible in top nav',
      verified: true,
    } as SelectorConfig,
    moreButton: {
      primary: 'text=MORE',
      fallback: 'button:has-text("MORE"), a:has-text("MORE"), [aria-label="MORE"], [title="MORE"]',
      timeout: 10000,
      description: 'MORE button in top navigation bar (00:37 in POS video)',
      verified: true,
    } as SelectorConfig,
    loginForm: {
      primary: '#txtName, input[placeholder*="User Name" i], input[name*="user" i]',
      fallback: 'input[type="password"], button:has-text("LOGIN")',
      timeout: 5000,
      description: 'Detect if login form is shown (00:00 - 00:10 in POS video)',
      verified: true,
    } as SelectorConfig,
    outletSelection: {
      primary: '.blog-sider-common, :text("Last Login")',
      fallback: ':text("FM04 - Hoàng Hoa Thám"), :text("DC01 - Nơ Trang Long")',
      timeout: 15000,
      description: 'Outlet selection screen at /shop/select-outlets (00:13 - 00:15 in POS video)',
      verified: true,
    } as SelectorConfig,
    shopLoadingSteps: {
      primary: ':text("Loading Information Shop"), :text("Loading Max Value Currency"), :text("Loading Format Config"), :text("Loading General Setting"), :text("Loading Shop Mode"), :text("Loading Invoice"), :text("Loading Denomination"), :text("Loading CRM System"), :text("Loading Default Customer")',
      fallback: ':text("Loading data. Please wait a minute")',
      timeout: 45000,
      description: '9-step sequential shop initialization overlay after selecting an outlet (00:16 - 00:27 in POS video)',
      verified: true,
    } as SelectorConfig,
  },

  moreModal: {
    modal: {
      primary: '[role="dialog"]:has-text("More"), .modal:has-text("More"), .dx-popup-normal:has-text("More")',
      fallback: 'div:has(> :text("More")):has(input[placeholder*="Search Menu" i])',
      timeout: 8000,
      description: 'More modal/dialog — contains Search Menu input at top (00:38 in POS video)',
      verified: true,
    } as SelectorConfig,
    searchMenuInput: {
      primary: 'input[placeholder="Search Menu"]',
      fallback: 'input[placeholder*="Search"]',
      timeout: 5000,
      description: 'Search Menu input inside More modal',
      verified: true,
    } as SelectorConfig,
    reportTile: {
      primary: ':text-is("Report")',
      fallback: 'div:has-text("Report"):not(:has-text("Sales")):not(:has-text("Purchase")):not(:has-text("Store"))',
      timeout: 8000,
      description: 'Report tile in More modal — bottom-left tile in grid (00:38 in POS video)',
      verified: true,
    } as SelectorConfig,
    closeButton: {
      primary: 'button:near(:text("More")):has(svg)',
      fallback: '[aria-label="Close"], button.close, .dx-closebutton',
      timeout: 5000,
      description: 'X close button on More modal',
      verified: true,
    } as SelectorConfig,
  },

  reportMenu: {
    backButton: {
      primary: 'button:has(svg):near(:text("Promotion"))',
      fallback: '[aria-label="Back"], button:has-text("←")',
      timeout: 5000,
      description: 'Back arrow (←) in report submenu',
      verified: true,
    } as SelectorConfig,
    promotionSection: {
      primary: ':text-is("Promotion")',
      fallback: 'h3:has-text("Promotion"), [class*="section"]:has-text("Promotion")',
      timeout: 5000,
      description: 'Promotion section header',
      verified: true,
    } as SelectorConfig,
    inventorySection: {
      primary: ':text-is("Inventory")',
      fallback: 'h3:has-text("Inventory"), [class*="section"]:has-text("Inventory")',
      timeout: 5000,
      description: 'Inventory section header in report menu',
      verified: true,
    } as SelectorConfig,
    inventoryOnhandItem: {
      primary: ':text-is("Inventory Onhand")',
      fallback: '[aria-label="Inventory Onhand"], [title="Inventory Onhand"], :text("Inventory Onhand")',
      timeout: 8000,
      description: 'Inventory Onhand menu item (00:40 in POS video)',
      verified: true,
    } as SelectorConfig,
    salesSection: {
      primary: ':text-is("Sales")',
      fallback: 'h3:has-text("Sales")',
      timeout: 8000,
      description: 'Sales section header',
      verified: true,
    } as SelectorConfig,
    salesTransactionDetailItem: {
      primary: ':text-is("Sales Transaction Detail")',
      fallback: '[aria-label="Sales Transaction Detail"], :text("Sales Transaction Detail")',
      timeout: 10000,
      description: 'Sales Transaction Detail menu item (04:46 in POS video)',
      verified: true,
    } as SelectorConfig,
  },

  inventoryOnhand: {
    pageTitle: {
      primary: 'h1:has-text("Inventory Onhand"), h2:has-text("Inventory Onhand")',
      fallback: 'main :text("Inventory Onhand"):visible, :text-is("Inventory Onhand")',
      timeout: 15000,
      description: 'Page title — confirms correct page loaded at /admin/report/inventory-onhand',
      verified: true,
    } as SelectorConfig,
    storeDropdown: {
      primary: 'select:near(:text("Store"))',
      fallback: '[role="combobox"]:near(:text("Store")), dx-select-box',
      timeout: 8000,
      description: 'Store filter dropdown — default value "All"',
      verified: true,
    } as SelectorConfig,
    searchButton: {
      primary: 'button:has-text("Search"):not([class*="list"]), dx-button[icon="search"]',
      fallback: 'button.search, button[type="submit"], a:has-text("Search")',
      timeout: 8000,
      description: 'Green Search button (00:45 in POS video)',
      verified: true,
    } as SelectorConfig,
    searchListInput: {
      primary: 'input[placeholder*="Search List"], input[placeholder*="Search"]',
      fallback: '.search-list-input, input.search',
      timeout: 5000,
      description: 'Search List text filter input',
      verified: true,
    } as SelectorConfig,
    reportListButton: {
      primary: 'button:has-text("Report List")',
      fallback: '[aria-label="Report List"], [title="Report List"]',
      timeout: 8000,
      description: 'Red Report List button — top-right corner',
      verified: true,
    } as SelectorConfig,
    dataTable: {
      primary: 'table',
      fallback: '[role="grid"], [role="table"], .data-table, .dx-datagrid',
      timeout: 20000,
      description: 'Inventory data table',
      verified: true,
    } as SelectorConfig,
    noDataIndicator: {
      primary: ':text-is("No data")',
      fallback: ':text("No data"):visible, .no-data, .dx-datagrid-nodata',
      timeout: 5000,
      description: 'No data indicator',
      verified: true,
    } as SelectorConfig,
    excelButton: {
      primary: '.dx-datagrid-header-panel .dx-datagrid-export-button, .dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)',
      fallback: '.dx-datagrid-header-panel [aria-label*="Export to Excel" i], .dx-datagrid-header-panel [title*="Export" i], .dx-datagrid-export-button, .dx-button:has(.dx-icon-xlsxfile)',
      timeout: 15000,
      description: 'Square Excel export button on DataGrid toolbar with xlsx icon (04:11 in POS video)',
      verified: true,
    } as SelectorConfig,
    exportingOverlay: {
      primary: '.dx-loadpanel-content:has-text("Exporting"), :text("Exporting...")',
      fallback: '.dx-export-loadpanel',
      timeout: 30000,
      description: 'Exporting... spinner popup shown for ~6s while generating Excel blob (04:12 - 04:17 in POS video)',
      verified: true,
    } as SelectorConfig,
  },

  salesTransactionDetail: {
    pageTitle: {
      primary: 'h1:has-text("Sales Transaction Detail"), h2:has-text("Sales Transaction Detail")',
      fallback: 'main :text("Sales Transaction Detail"):visible, :text-is("Sales Transaction Detail")',
      timeout: 15000,
      description: 'Page title — confirms correct page loaded at /admin/report/sales-transaction-detail',
      verified: true,
    } as SelectorConfig,
    fromDateInput: {
      primary: 'input[type="date"]:first-of-type',
      fallback: 'input:near(:text("From Date")):first',
      timeout: 8000,
      description: 'From Date input — format DD/MM/YYYY (04:49 in POS video)',
      verified: true,
    } as SelectorConfig,
    toDateInput: {
      primary: 'input[type="date"]:nth-of-type(2)',
      fallback: 'input:near(:text("To Date"))',
      timeout: 8000,
      description: 'To Date input — format DD/MM/YYYY (05:25 in POS video)',
      verified: true,
    } as SelectorConfig,
    storeDropdown: {
      primary: 'select:near(:text("Store"))',
      fallback: '[role="combobox"]:near(:text("Store")), dx-select-box',
      timeout: 8000,
      description: 'Store filter dropdown',
      verified: true,
    } as SelectorConfig,
    searchButton: {
      primary: 'button:has-text("Search"), dx-button[icon="search"]',
      fallback: 'button[type="submit"]:has-text("Search"), a:has-text("Search")',
      timeout: 8000,
      description: 'Green Search button (transitions to "Loading data" during 76s query at 05:31 in POS video)',
      verified: true,
    } as SelectorConfig,
    excelButton: {
      primary: '.dx-datagrid-header-panel .dx-datagrid-export-button, .dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)',
      fallback: '.dx-datagrid-header-panel [aria-label*="Export to Excel" i], .dx-datagrid-header-panel [title*="Export" i], .dx-datagrid-export-button, .dx-toolbar .dx-button:has(i[class*="xlsx"]), button:has-text("Excel")',
      timeout: 15000,
      description: 'Square Excel export button on DataGrid toolbar with fallback to blue Excel button (06:50 in POS video)',
      verified: true,
    } as SelectorConfig,
    blueExcelButton: {
      primary: 'button:has-text("Excel"):not(.dx-datagrid-export-button), dx-button:has-text("Excel")',
      fallback: '.btn-excel, a:has-text("Excel")',
      timeout: 10000,
      description: 'Blue Excel button next to green Search button (clicked at 06:50 in POS video)',
      verified: true,
    } as SelectorConfig,
    pdfButton: {
      primary: 'button:has-text("PDF")',
      fallback: '[aria-label="PDF"]',
      timeout: 5000,
      description: 'Gray PDF button',
      verified: true,
    } as SelectorConfig,
    reportListButton: {
      primary: 'button:has-text("Report List")',
      fallback: '[aria-label="Report List"]',
      timeout: 5000,
      description: 'Red Report List button',
      verified: true,
    } as SelectorConfig,
    dataTable: {
      primary: 'table',
      fallback: '[role="grid"], [role="table"], .dx-datagrid',
      timeout: 20000,
      description: 'Sales data table',
      verified: true,
    } as SelectorConfig,
    noDataIndicator: {
      primary: ':text-is("No data")',
      fallback: ':text("No data"):visible, .dx-datagrid-nodata',
      timeout: 5000,
      description: 'No data indicator',
      verified: true,
    } as SelectorConfig,
  },

  gridFilter: {
    grid: {
      primary: '.dx-datagrid',
      fallback: 'div.dx-widget:has(.dx-datagrid-headers)',
      timeout: 10000,
      description: 'DevExtreme DataGrid root container',
      verified: true,
    } as SelectorConfig,
    headerCell: {
      primary: '.dx-header-row td',
      fallback: '.dx-datagrid-headers th, .dx-datagrid-headers td',
      timeout: 8000,
      description: 'Column header cell in the grid',
      verified: true,
    } as SelectorConfig,
    filterIcon: {
      primary: '.dx-header-filter',
      fallback: '.dx-header-filter-empty, span[class*="header-filter"]',
      timeout: 5000,
      description: 'Filter funnel icon on column header (clicked at 03:07 in POS video)',
      verified: true,
    } as SelectorConfig,
    popupMenu: {
      primary: '.dx-header-filter-menu',
      fallback: '.dx-overlay-content:has(.dx-header-filter-menu), .dx-popup-content:has(input[placeholder*="Search"])',
      timeout: 8000,
      description: 'DevExtreme header filter popup overlay (03:08 - 04:08 in POS video)',
      verified: true,
    } as SelectorConfig,
    scrollViewContent: {
      primary: '.dx-header-filter-menu .dx-scrollview-content, .dx-popup-content .dx-scrollview-content',
      fallback: '.dx-header-filter-menu .dx-scrollable-container, .dx-list',
      timeout: 5000,
      description: 'Virtual scroll container inside DevExtreme header filter popup',
      verified: true,
    } as SelectorConfig,
    searchInput: {
      primary: '.dx-header-filter-menu input.dx-texteditor-input',
      fallback: '.dx-header-filter-menu input[placeholder="Search"], input[placeholder*="Search"]',
      timeout: 5000,
      description: 'Search box inside header filter popup',
      verified: true,
    } as SelectorConfig,
    listItem: {
      primary: '.dx-header-filter-menu .dx-list-item',
      fallback: '.dx-header-filter-menu .dx-item, div.dx-list-item',
      timeout: 5000,
      description: 'List item inside header filter popup',
      verified: true,
    } as SelectorConfig,
    checkbox: {
      primary: '.dx-checkbox',
      fallback: 'input[type="checkbox"]',
      timeout: 5000,
      description: 'Checkbox for selecting filter values in popup',
      verified: true,
    } as SelectorConfig,
    okButton: {
      primary: '.dx-popup-bottom .dx-button:has-text("OK")',
      fallback: '.dx-button:has-text("OK"), button:has-text("OK")',
      timeout: 5000,
      description: 'OK button at bottom of filter popup (04:08 in POS video)',
      verified: true,
    } as SelectorConfig,
    cancelButton: {
      primary: '.dx-popup-bottom .dx-button:has-text("Cancel")',
      fallback: '.dx-button:has-text("Cancel"), button:has-text("Cancel")',
      timeout: 5000,
      description: 'Cancel button at bottom of filter popup',
      verified: true,
    } as SelectorConfig,
    loadPanel: {
      primary: '.dx-loadpanel',
      fallback: '.loading-wave, .dx-loadindicator-wrapper',
      timeout: 10000,
      description: 'Loading overlay during filtering or query execution',
      verified: true,
    } as SelectorConfig,
  },
} as const;
