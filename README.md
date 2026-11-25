# OmniFlow Studio (v2.0.0) — 100% Standalone Browser Extension

> **Tiện ích mở rộng trình duyệt Chrome / Edge (Manifest V3) tự động hóa hoàn toàn quy trình POS RPFO & SAP Business One — 100% chạy trực tiếp trên trình duyệt, không cần cài đặt phần mềm desktop hay Local Server.**

[![Version](https://img.shields.io/badge/version-2.0.0-2563EB.svg?style=flat-square)](./OmniFlow-Studio/apps/extension/public/manifest.json)
[![Manifest](https://img.shields.io/badge/Manifest-V3-059669.svg?style=flat-square)](./OmniFlow-Studio/apps/extension/public/manifest.json)
[![Browser](https://img.shields.io/badge/Chrome%20%7C%20Edge-100%25%20Standalone-0EA5E9.svg?style=flat-square)](#cài-đặt-nhanh-load-unpacked)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?style=flat-square)](./OmniFlow-Studio/apps/extension/package.json)

---

## Tổng quan (Overview)

**OmniFlow Studio v2.0.0** là extension trình duyệt **100% độc lập (Standalone)** cho Google Chrome và Microsoft Edge:
- **Không cần** ứng dụng desktop hay máy chủ nền (Local Server) bên ngoài trình duyệt, **không cần** kết nối cloud.
- Toàn bộ cấu hình, nhật ký hoạt động và lịch sử tệp tải xuống được lưu cục bộ an toàn trong `chrome.storage.local`.
- Điều phối và thực thi tự động hóa **trực tiếp trên tab trình duyệt** của bạn thông qua `chrome.tabs`, `chrome.scripting` và `chrome.downloads`.

---

## Tính năng chính

### 1. Tự động hóa POS RPFO (`pos-engine`)
- **Đăng nhập & chọn Outlet tự động**: Hỗ trợ Angular form binding, tự động chọn điểm bán ưu tiên (mặc định `FM04`) và phục hồi phiên `/home` / `app-page-not-found`.
- **Doanh số POS (`DOWNLOAD_SALES`)**: Tự động điều hướng `MORE -> Report`, thiết lập khoảng ngày (`TODAY`, `YESTERDAY`, `CUSTOM`), lọc và xuất Excel Sales Transaction Detail.
- **Tồn kho POS 12 Kho (`DOWNLOAD_INVENTORY`)**: Lọc chính xác 12 kho SLOC (`SDC0101` .. `SFM1001`) trên DevExtreme `dxDataGrid` (hỗ trợ cả `columnOption('filterValues')` và Virtual Scroll Header Filter fallback) và xuất Excel Onhand.
- **Visual Cursor Overlay**: Con trỏ ảo trực quan hiển thị từng thao tác di chuyển, click, nhập liệu và highlight ngay trên trang POS.

### 2. Tự động hóa SAP Business One (`sap-engine`)
- **SLD Logon & Browser Access**: Tự động điền thông tin máy chủ, công ty (`Công ty TNHH Thương Mại LARIA`), tài khoản và xử lý hộp thoại cảnh báo trùng phiên (`autoTakeOverSession`).
- **SAML2 Auto-Recovery**: Tự động phát hiện lỗi `/dispatcher/saml2/sp/acs` (`NullPointerException`) và điều hướng khôi phục về `/dispatcher/`.
- **Query Manager & Pricelist Export (`SAP_AUTOMATION`)**: Mở `Danh Mục -> Danh sách item ncc pricelist_non_Asset` và xuất file Excel qua `chrome.downloads`.

### 3. Quy trình tổng hợp Daily Procurement (`DAILY_PROCUREMENT`)
- Chạy tuần tự toàn trình **Doanh số POS → Tồn kho POS 12 Kho → SAP Business One** chỉ với một lần bấm, hỗ trợ dừng khẩn cấp (`ABORT_WORKFLOW`) qua `AbortController`.

### 4. Giao diện Light-First UX/UI hiện đại
- **Side Panel (`sidepanel/*`)**: Giao diện sáng (Light Mode mặc định, có nút chuyển Sáng/Tối trên header) gồm 4 tab:
  - **Điều khiển**: Chọn quy trình, khoảng ngày (`TODAY` / `YESTERDAY` / `CUSTOM`), Outlet, 12 kho SLOC với bộ đếm trực tiếp, nút Thực thi / Dừng và stepper 5 bước.
  - **Tệp tin**: Danh sách tệp Excel đã tải về từ `chrome.storage.local` kèm nút mở file/thư mục (`chrome.downloads.show`).
  - **Console**: Nhật ký thực thi trực tiếp (live logs) với nút Xóa và Sao chép.
  - **Cấu hình**: Lưu toàn bộ thông tin đăng nhập & tham số POS / SAP cục bộ vào `chrome.storage.local`, hỗ trợ hiện/ẩn mật khẩu và kiểm tra kết nối.
- **Popup (`popup/*`)**: Huy hiệu `100% Extension • Sẵn sàng`, kiểm tra độ trễ POS/SAP, 5 nút chạy nhanh, thanh tiến trình trực tiếp + nút Dừng, và nút `Mở Bảng điều khiển`.
- **Floating Widget trên trang POS & SAP (`content/*`)**: Nút nổi gọn nhẹ ngay góc phải dưới trang POS/SAP giúp điền tài khoản, chọn Outlet, khôi phục SAML2, chạy quy trình và hiển thị toast tiến trình trực tiếp.

---

## Cài đặt nhanh (Load Unpacked)

1. Mở trình duyệt **Google Chrome** (`chrome://extensions/`) hoặc **Microsoft Edge** (`edge://extensions/`).
2. Bật chế độ **Developer mode** (Chế độ dành cho nhà phát triển).
3. Nhấn **Load unpacked** (Tải tiện ích đã giải nén) và chọn một trong hai thư mục sau:
   - `release/extension` (bản build sẵn để cài đặt ngay)
   - hoặc `OmniFlow-Studio/apps/extension/dist` (sau khi tự build từ mã nguồn)
4. Gói nén phát hành cũng có sẵn tại `release/OmniFlow-Extension-v2.0.0.zip`.

---

## Build từ mã nguồn (Build from Source)

Yêu cầu: **Node.js (>= 20)** và **pnpm (>= 9)**.

```bash
cd OmniFlow-Studio
pnpm install
pnpm --filter @fm/extension typecheck
pnpm --filter @fm/extension build
```

Lệnh `pnpm --filter @fm/extension build` sử dụng `esbuild` để đóng gói vào `OmniFlow-Studio/apps/extension/dist`, đồng thời đồng bộ sang `release/extension` và tạo gói `release/OmniFlow-Extension-v2.0.0.zip`.

---

## Cấu trúc dự án (Project Structure)

```text
.
├── release/
│   ├── extension/                    # Extension đã build sẵn (Load unpacked trực tiếp)
│   └── OmniFlow-Extension-v2.0.0.zip # Gói nén phát hành v2.0.0
└── OmniFlow-Studio/
    ├── apps/
    │   ├── extension/                # [Chính] OmniFlow Standalone Browser Extension (MV3)
    │   │   ├── public/manifest.json
    │   │   ├── src/
    │   │   │   ├── background/       # Service worker điều phối tab, workflow & downloads
    │   │   │   ├── engines/          # pos-engine.ts, sap-engine.ts, cursor-overlay.ts
    │   │   │   ├── popup/            # Popup UI (Light Mode)
    │   │   │   ├── sidepanel/        # Side Panel 4 tab (Light/Dark toggle)
    │   │   │   ├── content/          # Floating widget trên POS & SAP
    │   │   │   ├── shared/           # storage.ts (chrome.storage.local)
    │   │   │   └── types.ts          # Định nghĩa kiểu dữ liệu & RPC message
    │   │   └── build.mjs             # Script build esbuild & đóng gói release
    │   ├── local-agent/              # [Legacy / Tùy chọn] Monorepo desktop runner cũ
    │   └── web/                      # [Legacy / Tùy chọn] Giao diện web cũ
    └── packages/                     # Các package monorepo dùng chung / lưu trữ
```
