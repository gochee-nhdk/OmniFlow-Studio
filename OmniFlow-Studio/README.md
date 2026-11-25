# OmniFlow Studio (v2.1.0) — 100% Standalone Browser Extension

> **Tiện ích mở rộng trình duyệt Chrome / Edge (Manifest V3) tự động hóa POS RPFO & SAP Business One — chạy 100% trực tiếp trong trình duyệt, không cần desktop app hay Local Server.**

[![Version](https://img.shields.io/badge/version-2.1.0-2563EB.svg?style=flat-square)](./apps/extension/public/manifest.json)
[![Manifest](https://img.shields.io/badge/Manifest-V3-059669.svg?style=flat-square)](./apps/extension/public/manifest.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?style=flat-square)](./apps/extension/package.json)

---

## Tổng quan (Overview)

**OmniFlow Studio v2.1.0** hoạt động dưới dạng **100% Standalone Browser Extension**:
- **Không cần** ứng dụng desktop, máy chủ WebSocket hay bất kỳ dịch vụ nền nào bên ngoài trình duyệt.
- Lưu trữ cấu hình, nhật ký hoạt động và lịch sử tải tệp hoàn toàn cục bộ trong `chrome.storage.local`.
- Điều khiển tự động hóa trực tiếp trên tab POS RPFO và SAP Business One đang mở (hoặc tự động mở tab mới trong cửa sổ hiện tại) thông qua `chrome.tabs`, `chrome.scripting` và `chrome.downloads`.

---

## Tính năng nổi bật

### 1. Tự động hóa POS RPFO (`apps/extension/src/engines/pos-engine.ts`)
- Tự động đăng nhập, khôi phục `/home` hoặc `app-page-not-found`, chọn Outlet ưu tiên (mặc định `FM04`).
- **Doanh số POS (`DOWNLOAD_SALES`)**: Điều hướng `MORE -> Report`, áp dụng khoảng ngày (`TODAY`, `YESTERDAY`, `PREVIOUS_WEEK`, `CUSTOM`), xuất Excel Sales Transaction Detail.
- **Tồn kho POS 12 Kho (`DOWNLOAD_INVENTORY`)**: Lọc chính xác 12 mã kho SLOC (`SDC0101` .. `SFM1001`) trên lưới DevExtreme `dxDataGrid` (hỗ trợ `columnOption('filterValues')` và Virtual Scroll Header Filter fallback), xuất Excel Onhand.
- **Con trỏ ảo trực quan (`cursor-overlay.ts`)**: Shadow DOM overlay hiển thị di chuyển, click, nhập liệu và highlight ngay trên trang web.

### 2. Tự động hóa SAP Business One (`apps/extension/src/engines/sap-engine.ts`)
- Hỗ trợ SLD Logon & Browser Access Dispatcher (bao gồm cả thực thi xuyên `iframe` với `allFrames: true`).
- Tự động khôi phục lỗi SAML2 `/dispatcher/saml2/sp/acs` (`NullPointerException`) về `/dispatcher/`.
- Tự động xử lý cảnh báo trùng phiên (`autoTakeOverSession`), mở Query Manager (`Danh Mục -> Danh sách item ncc pricelist_non_Asset`) và xuất Excel Pricelist.

### 3. Daily Procurement (`DAILY_PROCUREMENT`)
- Chạy tuần tự **Doanh số POS → Tồn kho POS 12 Kho → SAP Business One** với thanh tiến trình thời gian thực và hỗ trợ dừng giữa chừng (`ABORT_WORKFLOW`).

### 4. Giao diện Light-First UX/UI
- **Side Panel (`apps/extension/src/sidepanel/`)**: Giao diện sáng mặc định với 5 tab: **Agent** (đọc DOM của tab, chụp ảnh để người dùng xem, và chạy kế hoạch sau khi duyệt), **Điều khiển**, **Tệp tin**, **Console**, **Cấu hình**.
- **SOP Knowledge (`apps/extension/src/engines/workflow-knowledge.ts`)**: Quy trình POS/SAP được chuẩn hóa từ PDF thao tác; Purchase Order và Goods Return chỉ mở form, không tự ghi sổ chứng từ.
- **Popup (`apps/extension/src/popup/`)**: Trạng thái `100% Extension • Sẵn sàng`, ping kiểm tra POS/SAP, 5 tác vụ nhanh, thanh tiến trình + nút Dừng và nút `Mở Bảng điều khiển`.
- **Floating Widget (`apps/extension/src/content/`)**: Widget nổi Light Mode trên trang POS & SAP để điền nhanh tài khoản, chọn Outlet, khôi phục SAML2, chạy quy trình và xem toast tiến trình trực tiếp.

---

## Cài đặt nhanh (Load Unpacked)

1. Mở `chrome://extensions/` (Chrome) hoặc `edge://extensions/` (Edge).
2. Bật **Developer mode**.
3. Chọn **Load unpacked** và trỏ tới `apps/extension/dist` (hoặc thư mục `release/extension`).

---

## Build từ mã nguồn (Build from Source)

Yêu cầu: **Node.js (>= 20)** và **pnpm (>= 9)**.

```bash
pnpm install
pnpm --filter @fm/extension typecheck
pnpm --filter @fm/extension build
```

---

## Cấu trúc Workspace

```text
OmniFlow-Studio/
├── apps/
│   ├── extension/            # [Chính] OmniFlow Standalone Browser Extension v2.1.0 (MV3)
│   │   ├── public/           # manifest.json & icons
│   │   ├── src/
│   │   │   ├── background/   # Service worker điều phối workflow & downloads
│   │   │   ├── engines/      # pos-engine.ts, sap-engine.ts, cursor-overlay.ts
│   │   │   ├── popup/        # Popup UI
│   │   │   ├── sidepanel/    # Side Panel UI (4 tabs)
│   │   │   ├── content/      # Floating widgets cho POS & SAP
│   │   │   ├── shared/       # storage.ts (chrome.storage.local)
│   │   │   └── types.ts      # Types & message protocol
│   │   ├── dist/             # Output build sẵn sàng Load unpacked
│   │   └── build.mjs         # esbuild bundler & release sync
│   ├── local-agent/          # [Legacy / Tùy chọn] Desktop runner cũ
│   └── web/                  # [Legacy / Tùy chọn] Web UI cũ
├── packages/                 # Các package monorepo lưu trữ / tùy chọn
└── docs/                     # Tài nguyên tài liệu & thương hiệu
```
