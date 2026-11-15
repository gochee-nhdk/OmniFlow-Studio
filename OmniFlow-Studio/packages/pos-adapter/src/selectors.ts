// FM AUTO OPS — POS RPFO Selector Registry
// Source: Generic UI selectors for POS RPFO Application

export interface SelectorConfig {
  primary: string;
  fallback: string;
  timeout: number;
  description: string;
  verified: boolean;
  notes?: string;
}

export const POS_SELECTORS = {
  dashboard: {
    pageIndicator: {
      primary: 'text=IN SHOP',
      fallback: '[title="IN SHOP"], header:has-text("IN SHOP")',
      timeout: 15000,
      description: 'Confirms POS dashboard loaded and authenticated — "IN SHOP" text visible in top nav',
      verified: true,
    } as SelectorConfig,
    moreButton: {
      primary: 'text=MORE',
      fallback: 'button:has-text("MORE"), [aria-label="MORE"], [title="MORE"]',
      timeout: 10000,
      description: 'MORE button in top navigation bar',
      verified: true,
    } as SelectorConfig,
    loginForm: {
      primary: 'input[type="password"]',
      fallback: 'form:has(input[type="password"])',
      timeout: 3000,
      description: 'Detect if login form is shown (not authenticated)',
      verified: false,
      notes: 'Login page not seen in screenshots — selector is a standard assumption',
    } as SelectorConfig,
  },

  moreModal: {
    modal: {
      primary: '[role="dialog"]:has-text("More"), .modal:has-text("More")',
      fallback: 'div:has(> :text("More")):has(input[placeholder="Search Menu"])',
      timeout: 8000,
      description: 'More modal/dialog — contains Search Menu input at top',
      verified: true,
    } as SelectorConfig,
    searchMenuInput: {
      primary: 'input[placeholder="Search Menu"]',
      fallback: 'input[placeholder*="Search"]',
      timeout: 5000,
      description: 'Search Menu input inside More modal — confirmed in screenshot',
      verified: true,
    } as SelectorConfig,
    reportTile: {
      primary: ':text-is("Report")',
      fallback: 'div:has-text("Report"):not(:has-text("Sales")):not(:has-text("Purchase")):not(:has-text("Store"))',
      timeout: 8000,
      description: 'Report tile in More modal — bottom-left tile in grid',
      verified: true,
    } as SelectorConfig,
    closeButton: {
      primary: 'button:near(:text("More")):has(svg)',
      fallback: '[aria-label="Close"], button.close',
      timeout: 5000,
      description: 'X close button on More modal — visible top-right of modal',
      verified: true,
    } as SelectorConfig,
  },

  reportMenu: {
    backButton: {
      primary: 'button:has(svg):near(:text("Promotion"))',
      fallback: '[aria-label="Back"], button:has-text("←")',
      timeout: 5000,
      description: 'Back arrow (←) in report submenu — visible after clicking Report tile',
      verified: true,
    } as SelectorConfig,
    promotionSection: {
      primary: ':text-is("Promotion")',
      fallback: 'h3:has-text("Promotion"), [class*="section"]:has-text("Promotion")',
      timeout: 5000,
      description: 'Promotion section header — first section visible in report submenu',
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
      fallback: '[aria-label="Inventory Onhand"], [title="Inventory Onhand"]',
      timeout: 8000,
      description: 'Inventory Onhand menu item — first item under Inventory section',
      verified: true,
    } as SelectorConfig,
    salesSection: {
      primary: ':text-is("Sales")',
      fallback: 'h3:has-text("Sales")',
      timeout: 8000,
      description: 'Sales section header — below Inventory section, may require scrolling',
      verified: true,
      notes: 'Sales section is below initial viewport — modal scrollbar must be used, not browser scrollbar',
    } as SelectorConfig,
    salesTransactionDetailItem: {
      primary: ':text-is("Sales Transaction Detail")',
      fallback: '[aria-label="Sales Transaction Detail"]',
      timeout: 10000,
      description: 'Sales Transaction Detail menu item — in Sales section, below initial viewport',
      verified: true,
      notes: 'Must scroll modal content to reach this item',
    } as SelectorConfig,
  },

  inventoryOnhand: {
    pageTitle: {
      primary: 'h1:has-text("Inventory Onhand"), h2:has-text("Inventory Onhand")',
      fallback: 'main :text("Inventory Onhand"):visible',
      timeout: 15000,
      description: 'Page title — confirms correct page loaded at /admin/report/inventory-onhand',
      verified: true,
    } as SelectorConfig,
    storeDropdown: {
      primary: 'select:near(:text("Store"))',
      fallback: '[role="combobox"]:near(:text("Store"))',
      timeout: 8000,
      description: 'Store filter dropdown — default value "All" visible in screenshot',
      verified: true,
    } as SelectorConfig,
    searchButton: {
      primary: 'button:has-text("Search"):not([class*="list"])',
      fallback: 'button.search, button[type="submit"]',
      timeout: 8000,
      description: 'Green Search button — confirmed in screenshot',
      verified: true,
    } as SelectorConfig,
    searchListInput: {
      primary: 'input[placeholder*="Search List"], input[placeholder*="Search"]',
      fallback: '.search-list-input, input.search',
      timeout: 5000,
      description: 'Search List text filter input — visible top-right area of page',
      verified: true,
    } as SelectorConfig,
    reportListButton: {
      primary: 'button:has-text("Report List")',
      fallback: '[aria-label="Report List"], [title="Report List"]',
      timeout: 8000,
      description: 'Red Report List button — top-right corner. EXPORT BEHAVIOR UNKNOWN.',
      verified: true,
      notes: 'BLOCKED: Export mechanism unknown. Must inspect live DOM clicking this button to discover behavior.',
    } as SelectorConfig,
    dataTable: {
      primary: 'table',
      fallback: '[role="grid"], [role="table"], .data-table',
      timeout: 20000,
      description: 'Inventory data table — confirmed exists (shown in empty state in screenshot)',
      verified: true,
    } as SelectorConfig,
    noDataIndicator: {
      primary: ':text-is("No data")',
      fallback: ':text("No data"):visible, .no-data',
      timeout: 5000,
      description: 'No data indicator — "No data" text confirmed visible in screenshot',
      verified: true,
    } as SelectorConfig,
    excelButton: {
      primary: '.dx-datagrid-header-panel .dx-datagrid-export-button, .dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)',
      fallback: '.dx-datagrid-header-panel [aria-label*="Export to Excel" i], .dx-datagrid-header-panel [title*="Export" i], .dx-datagrid-export-button',
      timeout: 10000,
      description: 'Square Excel export button on DataGrid toolbar with xlsx icon (Hình 3 & 4)',
      verified: true,
      notes: 'Square icon button on grid header panel with [xlsx] icon matching Hình 3 & 4',
    } as SelectorConfig,
  },

  salesTransactionDetail: {
    pageTitle: {
      primary: 'h1:has-text("Sales Transaction Detail"), h2:has-text("Sales Transaction Detail")',
      fallback: 'main :text("Sales Transaction Detail"):visible',
      timeout: 15000,
      description: 'Page title — confirms correct page loaded at /admin/report/sales-transaction-detail',
      verified: true,
    } as SelectorConfig,
    fromDateInput: {
      primary: 'input[type="date"]:first-of-type',
      fallback: 'input:near(:text("From Date")):first',
      timeout: 8000,
      description: 'From Date input — format DD/MM/YYYY confirmed from screenshot (13/11/2026)',
      verified: true,
    } as SelectorConfig,
    toDateInput: {
      primary: 'input[type="date"]:nth-of-type(2)',
      fallback: 'input:near(:text("To Date"))',
      timeout: 8000,
      description: 'To Date input — format DD/MM/YYYY confirmed from screenshot (30/11/2026)',
      verified: true,
    } as SelectorConfig,
    storeDropdown: {
      primary: 'select:near(:text("Store"))',
      fallback: '[role="combobox"]:near(:text("Store"))',
      timeout: 8000,
      description: 'Store filter dropdown — default "All" confirmed in screenshot',
      verified: true,
    } as SelectorConfig,
    searchButton: {
      primary: 'button:has-text("Search")',
      fallback: 'button[type="submit"]:has-text("Search")',
      timeout: 8000,
      description: 'Green Search button — confirmed in screenshot',
      verified: true,
    } as SelectorConfig,
    excelButton: {
      primary: '.dx-datagrid-header-panel .dx-datagrid-export-button, .dx-datagrid-header-panel .dx-button:has(.dx-icon-xlsxfile)',
      fallback: '.dx-datagrid-header-panel [aria-label*="Export to Excel" i], .dx-datagrid-header-panel [title*="Export" i], .dx-datagrid-export-button, .dx-toolbar .dx-button:has(i[class*="xlsx"])',
      timeout: 10000,
      description: 'Square Excel export button on DataGrid toolbar with xlsx icon (Hình 3) — avoids blue form button',
      verified: true,
      notes: 'Square icon button on grid header panel with [xlsx] icon matching Hình 3',
    } as SelectorConfig,
    pdfButton: {
      primary: 'button:has-text("PDF")',
      fallback: '[aria-label="PDF"]',
      timeout: 5000,
      description: 'Gray PDF button — CONFIRMED in screenshot (gray, left of table)',
      verified: true,
    } as SelectorConfig,
    reportListButton: {
      primary: 'button:has-text("Report List")',
      fallback: '[aria-label="Report List"]',
      timeout: 5000,
      description: 'Red Report List button — confirmed in screenshot',
      verified: true,
    } as SelectorConfig,
    dataTable: {
      primary: 'table',
      fallback: '[role="grid"], [role="table"]',
      timeout: 20000,
      description: 'Sales data table — has horizontal scroll, confirmed in screenshot',
      verified: true,
    } as SelectorConfig,
    noDataIndicator: {
      primary: ':text-is("No data")',
      fallback: ':text("No data"):visible',
      timeout: 5000,
      description: 'No data indicator — confirmed in screenshot',
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
      description: 'Filter funnel icon on column header',
      verified: true,
    } as SelectorConfig,
    popupMenu: {
      primary: '.dx-header-filter-menu',
      fallback: '.dx-overlay-content:has(.dx-header-filter-menu), .dx-popup-content:has(input[placeholder*="Search"])',
      timeout: 8000,
      description: 'DevExtreme header filter popup overlay (Hình 5)',
      verified: true,
    } as SelectorConfig,
    searchInput: {
      primary: '.dx-header-filter-menu input.dx-texteditor-input',
      fallback: '.dx-header-filter-menu input[placeholder="Search"], input[placeholder*="Search"]',
      timeout: 5000,
      description: 'Search box inside header filter popup (Hình 5)',
      verified: true,
    } as SelectorConfig,
    listItem: {
      primary: '.dx-header-filter-menu .dx-list-item',
      fallback: '.dx-header-filter-menu .dx-item, div.dx-list-item',
      timeout: 5000,
      description: 'List item inside header filter popup (Hình 5)',
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
      description: 'OK button at bottom of filter popup (Hình 5)',
      verified: true,
    } as SelectorConfig,
    cancelButton: {
      primary: '.dx-popup-bottom .dx-button:has-text("Cancel")',
      fallback: '.dx-button:has-text("Cancel"), button:has-text("Cancel")',
      timeout: 5000,
      description: 'Cancel button at bottom of filter popup (Hình 5)',
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
