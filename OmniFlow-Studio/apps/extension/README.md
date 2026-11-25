# OmniFlow Studio Browser Extension v2.1.0 (100% Standalone — Manifest V3)

Tiện ích mở rộng trình duyệt (Browser Extension) **100% độc lập** cho quy trình tự động hóa **POS RPFO** & **SAP Business One** trên Google Chrome, Microsoft Edge và các trình duyệt nền Chromium — **không cần cài đặt `OmniFlow Studio.exe` hay kết nối `ws://127.0.0.1:7779`**.

---

## 🌟 Kiến Trúc & Tính Năng Nổi Bật

### 1. 🧠 100% Standalone Execution (`background/` & `engines/`)
- **Không phụ thuộc Local Server / WebSocket**: Toàn bộ logic điều phối (`background/index.ts`) và engine tự động hóa chạy trực tiếp bên trong trình duyệt qua `chrome.tabs`, `chrome.scripting.executeScript`, và `chrome.downloads`.
- **Lưu trữ nội bộ (`chrome.storage.local`)**: Cấu hình tài khoản POS/SAP, nhật ký hoạt động (logs) và lịch sử tệp tin tải về đều lưu cục bộ trên trình duyệt.
- **Visual Cursor Overlay (`engines/cursor-overlay.ts`)**: Con trỏ ảo trực quan (Shadow DOM, Bezier glide, hiệu ứng click/highlight) hiển thị trực tiếp trên tab POS/SAP khi quy trình chạy.
- **POS Engine (`engines/pos-engine.ts`)**:
  - Tự động đăng nhập POS RPFO, chọn Outlet (`FM04`), điều hướng báo cáo `Sales Transaction Detail` & `Inventory Onhand`.
  - Lọc chính xác 12 kho SLOC (`SDC0101`, `SFF0101`, `SFM0101`..`SFM1001`) qua DevExtreme `dxDataGrid` API + Virtual Scroll Header Filter fallback.
  - Theo dõi tải xuống Excel qua `chrome.downloads` & Blob hook.
- **SAP Engine (`engines/sap-engine.ts`)**:
  - Tự động đăng nhập SAP Business One SLD / Browser Access Dispatcher (`172.16.1.210:8100` / `172.16.0.201:40000`), hỗ trợ xử lý trong `iframe` (`allFrames: true`), khôi phục lỗi SAML2 `/dispatcher/saml2/sp/acs`, và chiếm phiên đăng nhập (`autoTakeOverSession`).
  - Điều hướng Query Manager (`Danh Mục` -> `Danh sách item ncc pricelist_non_Asset`) và xuất tệp Excel qua `chrome.downloads`.
- **Huy hiệu trạng thái (Badge)**:
  - 🟢 **ON** (Xanh lá): Sẵn sàng (Standalone v2.1.0).
  - 🔵 **RUN / %** (Xanh dương): Đang thực thi workflow với tiến trình real-time.

### 2. ⚡ Popup UI (`popup/`)
- Giao diện **Light-First** hiện đại, độ tương phản cao.
- Hiển thị trạng thái `100% Extension • Sẵn sàng` và độ trễ kết nối tới POS / SAP.
- **5 nút kích hoạt nhanh 1-Click** kèm thanh tiến trình real-time và nút **Dừng** (`ABORT_WORKFLOW`):
  - **Daily Procurement**: Chạy tuần tự Doanh số POS -> Tồn kho POS (12 Kho) -> SAP Business One.
  - **Doanh số POS**: Xuất Sales Transaction Detail.
  - **Tồn kho POS 12 Kho**: Xuất Inventory Onhand cho 12 kho SLOC.
  - **SAP Business One**: SLD Logon & Query Manager Export Pricelist.
  - **Kiểm tra POS**: Kiểm tra đăng nhập và outlet ưu tiên.
- Nút **Mở Bảng điều khiển** mở trực tiếp Side Panel.

### 3. 📑 Side Panel UI (`sidepanel/`)
- Giao diện **Light-First mặc định** kèm nút chuyển đổi **Sáng / Tối (Sun/Moon toggle)** ở thanh tiêu đề.
- **5 Tab quản trị**:
  1. **Agent**: Quét nhãn và trạng thái control trên tab hiện tại, chụp ảnh để người dùng xem, tạo kế hoạch một bước hoặc chọn SOP POS/SAP đã chuẩn hóa từ PDF. Chỉ thực hiện sau khi người dùng duyệt kế hoạch; thao tác DOM chỉ chọn đích khớp duy nhất và xác minh lại nhãn. Screenshot chỉ hiển thị trong side panel, chưa có OCR/vision model.
  2. **Điều khiển**: Chọn workflow, quy tắc ngày (`TODAY`, `YESTERDAY`, `PREVIOUS_WEEK`, `CUSTOM`), Outlet, chọn lọc 12 kho SLOC, nút Chạy / Dừng và stepper 5 bước.
  3. **Tệp tin**: Lịch sử các tệp Excel đã tải về từ `chrome.storage.local` kèm nút mở tệp/thư mục (`chrome.downloads.show`).
  4. **Console**: Trình xem log trực tiếp theo thời gian thực với nút `Xóa` và `Sao chép`.
  5. **Cấu hình**: Nhóm cấu hình `POS RPFO` và `SAP Business One`, lưu trực tiếp vào `chrome.storage.local` và nút `Kiểm tra kết nối`.

### 4. 📚 SOP Knowledge (`engines/workflow-knowledge.ts`)
- Chuẩn hóa hướng dẫn PDF thành checkpoint cho POS Inventory Onhand, POS Sales Transaction Detail tuần trước, SAP pricelist, SAP Purchase Order và Goods Return.
- POS Inventory ép đúng FM04 cùng 12 SLOC trong tài liệu; POS Sales dùng khoảng tuần đầy đủ trước đó (thứ Hai đến Chủ nhật, theo quy ước tuần được mã hóa hiện tại).
- SAP Purchase Order / Goods Return chỉ điều hướng tới form; người dùng tự rà soát và hoàn tất chứng từ.
- Bảng quy trình, nguồn trang, giả định ranh giới tuần và quy tắc thao tác: [`docs/WORKFLOW_KNOWLEDGE.md`](docs/WORKFLOW_KNOWLEDGE.md).

### 5. 🧩 Floating Widgets (`content/`)
- **POS Helper (`content/pos-autofill.ts`)** & **SAP Helper (`content/sap-autofill.ts`)**:
  - Widget nổi Light-First ngay trên trang POS / SAP (không có trạng thái "Agent Offline").
  - Cho phép điền nhanh form đăng nhập hoặc kích hoạt trực tiếp các tác vụ Doanh số / Tồn kho / Kiểm tra POS / SAP Pricelist kèm thông báo tiến trình trực tiếp.

---

## 🛠️ Hướng Dẫn Build Từ Mã Nguồn

Tại thư mục gốc `OmniFlow-Studio`:
```bash
pnpm install
pnpm --filter @fm/extension typecheck
pnpm --filter @fm/extension build
```

Script `build.mjs` sử dụng `esbuild` để đóng gói toàn bộ `background/index.ts` (bao gồm `engines/*`), `popup/popup.ts`, `sidepanel/sidepanel.ts`, `content/*.ts` vào:
- `OmniFlow-Studio/apps/extension/dist`
- `OmniFlow-Studio/release/extension`
- `release/extension`

---

## 🚀 Hướng Dẫn Cài Đặt (Load Unpacked)

### Google Chrome / Cốc Cốc / Brave:
1. Truy cập `chrome://extensions/`
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Chọn **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục `D:\tool auto\release\extension` (hoặc `OmniFlow-Studio/apps/extension/dist`).
5. Ghim (Pin) biểu tượng **OmniFlow Studio Extension** trên thanh công cụ để sử dụng.

### Microsoft Edge:
1. Truy cập `edge://extensions/`
2. Bật **Developer mode** ở thanh bên trái.
3. Chọn **Load unpacked** và trỏ tới thư mục `D:\tool auto\release\extension`.
