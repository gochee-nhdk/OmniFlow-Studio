import { POS_12_SLOCS, WorkflowType } from '../types.js';

/**
 * Operational knowledge transcribed from THAO TÁC PHẦN MỀM SAP_POS.pdf.
 * Screenshots in the source document are guidance, not authorization to bypass
 * confirmation. Runtime engines must still verify the current page and result.
 */
export interface StandardRoutine {
  id: string;
  label: string;
  aliases: string[];
  application: 'POS' | 'SAP';
  expectedHost: string;
  workflowType: WorkflowType;
    params?: Record<string, string | string[]>;
  checkpoints: string[];
  sourcePages: number[];
  manualCompletionRequired?: boolean;
}

export const STANDARD_ROUTINES: StandardRoutine[] = [
  {
    id: 'pos-inventory',
    label: 'POS · Xuất tồn kho Inventory Onhand',
    aliases: ['tồn kho', 'inventory onhand', 'xuất tồn', 'onhand'],
    application: 'POS',
    expectedHost: '172.16.1.200',
    workflowType: 'DOWNLOAD_INVENTORY',
    params: { outlet: 'FM04', storeFilter: 'FM04', slocs: [...POS_12_SLOCS] },
    checkpoints: [
      'Mở POS tại /home và đăng nhập.',
      'Chọn cửa hàng FM04 - Hoàng Hoa Thám; chờ Dashboard tải xong.',
      'More → Report → Inventory Onhand.',
      'Search và chờ lưới dữ liệu tải xong.',
      'Lọc Sloc Id theo đúng các mã SLOC được cấu hình (mặc định 12 mã trong tài liệu).',
      'Xuất Excel và xác nhận tệp tải về hoàn tất.',
    ],
    sourcePages: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  },
  {
    id: 'pos-sales-previous-week',
    label: 'POS · Xuất doanh số Sales Transaction Detail tuần trước',
    aliases: ['doanh số', 'sales transaction detail', 'sales', 'tuần trước'],
    application: 'POS',
    expectedHost: '172.16.1.200',
    workflowType: 'DOWNLOAD_SALES',
    params: { outlet: 'FM04', storeFilter: 'FM04', dateRule: 'PREVIOUS_WEEK' },
    checkpoints: [
      'Mở POS tại /home, đăng nhập, chọn FM04 và chờ Dashboard.',
      'More → Report → Sales Transaction Detail.',
      'Chọn khoảng thời gian của tuần trước (thứ Hai đến Chủ nhật đã hoàn tất).',
      'Search và chờ dữ liệu tải xong.',
      'Xuất Excel và xác nhận tệp tải về hoàn tất.',
    ],
    sourcePages: [12, 13, 14, 15, 16, 17, 18, 22, 23, 24, 25],
  },
  {
    id: 'sap-pricelist-export',
    label: 'SAP · Xuất danh sách item NCC pricelist_non_Asset',
    aliases: ['pricelist', 'price list', 'danh sách item ncc', 'nhà cung cấp'],
    application: 'SAP',
    expectedHost: '172.16.1.210',
    workflowType: 'SAP_AUTOMATION',
    checkpoints: [
      'Mở SAP Browser Access tại /dispatcher/.',
      'Chọn đúng Công ty TNHH Thương Mại LARIA (FM_PRO), nhập thông tin đăng nhập và Log on.',
      'Mở biểu tượng truy vấn/danh sách; vào Danh Mục.',
      'Mở Danh sach item ncc pricelist_non_Asset.',
      'Chọn xuất dữ liệu, định dạng .xlsx, xác nhận OK ở các hộp thoại.',
      'Xác nhận tệp tải về hoàn tất.',
    ],
    sourcePages: [1, 2, 3, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    id: 'sap-purchase-order',
    label: 'SAP · Mở màn hình Purchase Order',
    aliases: ['purchase order', 'đơn đặt hàng mua', 'lập po', 'đặt po'],
    application: 'SAP',
    expectedHost: '172.16.1.210',
    workflowType: 'SAP_AUTOMATION',
    params: { sapTargetModule: 'PURCHASING_PO' },
    checkpoints: [
      'Đăng nhập SAP và vào Purchasing - A/P.',
      'Mở Purchase Order.',
      'Dừng ở màn hình chứng từ để người dùng tự rà soát nhà cung cấp, hàng hóa, số lượng, giá và ngày giao trước khi lưu/gửi.',
    ],
    sourcePages: [3, 4],
    manualCompletionRequired: true,
  },
  {
    id: 'sap-goods-return',
    label: 'SAP · Mở màn hình Goods Return',
    aliases: ['goods return', 'goods returns', 'trả hàng mua', 'xuất trả hàng nhà cung cấp'],
    application: 'SAP',
    expectedHost: '172.16.1.210',
    workflowType: 'SAP_AUTOMATION',
    params: { sapTargetModule: 'PURCHASING_RETURN' },
    checkpoints: [
      'Đăng nhập SAP và vào Purchasing - A/P.',
      'Mở Goods Return.',
      'Dừng ở màn hình chứng từ để người dùng tự rà soát và quyết định có ghi sổ hay không.',
    ],
    sourcePages: [3, 4],
    manualCompletionRequired: true,
  },
];

export function matchStandardRoutine(task: string): StandardRoutine | undefined {
  const normalized = task.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const scored = STANDARD_ROUTINES.map((routine) => ({
    routine,
    score: routine.aliases.reduce((score, alias) => {
      const key = alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return normalized.includes(key) ? score + Math.max(1, key.length) : score;
    }, 0),
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length || (scored.length > 1 && scored[0].score === scored[1].score)) return undefined;
  return scored[0].routine;
}
