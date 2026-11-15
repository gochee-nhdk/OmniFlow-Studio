# CẤU TRÚC 1-CLICK LAUNCHER & AUTOMATION — FM AUTO OPS

## 1. Triết lý Thiết kế: "ONE CLICK. READY TO USE."

Người dùng doanh nghiệp (Purchasing, Procurement) không cần mở Terminal, không cần gõ lệnh `cd`, `pnpm dev` hay quản lý tiến trình nền. Hệ thống cung cấp **2 phương thức 1-Click** ngay trên Desktop:

```
                      MÀN HÌNH DESKTOP CỦA BẠN
   ┌───────────────────────────────┐     ┌───────────────────────────────┐
   │  [FM AUTO OPS (Desktop App)]  │     │ [FM AUTO OPS (Web Dashboard)] │
   │   Native Windows Window       │     │  Tự động mở Chrome / Edge     │
   └───────────────┬───────────────┘     └───────────────┬───────────────┘
                   │                                     │
                   ▼ (1 Click duy nhất)                  ▼ (1 Click duy nhất)
┌────────────────────────────────────────────────────────────────────────┐
│                   GIAO DIỆN FM AUTO OPS SẴN SÀNG                       │
│  - Trạng thái POS (172.16.1.200)   : CONNECTED                         │
│  - Trạng thái SAP (172.16.1.210)   : CONNECTED                         │
│  - Kho lưu trữ (D:\FM_AUTO_OPS)    : READY (9 Thư mục)                 │
│                                                                        │
│                 [ ▶ RUN DAILY PROCUREMENT ] (1 Click)                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chi tiết 2 Chế độ 1-Click Đã Được Tạo Sẵn

### Chế độ A: Desktop App (Native Electron)
- **Shortcut trên Desktop:** `FM AUTO OPS (Desktop App).lnk`
- **Tập tin thực thi:** `d:\tool auto\FM-AUTO-OPS\FM_AUTO_OPS.vbs`
- **Đặc điểm:** 
  - Khởi chạy ứng dụng Desktop độc lập (cửa sổ riêng biệt).
  - Sử dụng VBScript silent launcher: **Hoàn toàn KHÔNG hiện màn hình đen dòng lệnh (cmd.exe)**.
  - Tích hợp trực tiếp với Playwright để chạy automation nền.

### Chế độ B: Web Dashboard Siêu Tốc (Trình duyệt)
- **Shortcut trên Desktop:** `FM AUTO OPS (Web Dashboard).lnk`
- **Tập tin thực thi:** `d:\tool auto\FM-AUTO-OPS\Open_Web_Dashboard.vbs`
- **Đặc điểm:**
  - Khởi động web server tĩnh nội bộ siêu nhẹ (`scripts/serve.mjs` — khởi động dưới 50ms, 0MB RAM phụ).
  - Tự động mở ngay trình duyệt mặc định (Chrome/Edge) đến `http://localhost:3001`.
  - Phù hợp khi người dùng thích thao tác trên một tab trình duyệt quen thuộc.

---

## 3. Các vị trí Shortcut & File Khởi động

Bạn có thể bấm chạy từ bất kỳ đâu:
1. **Trên Desktop chính của bạn:**
   - `D:\OneDrive\Máy tính\FM AUTO OPS (Desktop App).lnk`
   - `D:\OneDrive\Máy tính\FM AUTO OPS (Web Dashboard).lnk`
2. **Trong thư mục lưu trữ D:\FM_AUTO_OPS\:**
   - `D:\FM_AUTO_OPS\FM_AUTO_OPS.bat` (hoặc `.vbs`)
   - `D:\FM_AUTO_OPS\Open_Web_Dashboard.bat` (hoặc `.vbs`)
3. **Trong thư mục dự án:**
   - `d:\tool auto\FM-AUTO-OPS\FM_AUTO_OPS.vbs`
   - `d:\tool auto\FM-AUTO-OPS\Open_Web_Dashboard.vbs`

---

## 4. Quy trình Trải nghiệm Người dùng (UX 1-Click)

1. **Bước 1:** Bật máy tính vào ca làm việc buổi sáng.
2. **Bước 2 (Click #1):** Nhấp đúp vào icon `FM AUTO OPS` trên Desktop. Giao diện tool hiện lên ngay lập tức.
3. **Bước 3 (Click #2):** Bấm nút xanh lớn **`RUN DAILY PROCUREMENT`**.
4. **Hệ thống tự động chạy toàn bộ:**
   - Đăng nhập POS & SAP.
   - Tải báo cáo Sales Transaction Detail & Inventory Onhand.
   - Kiểm tra tính toàn vẹn file Excel.
   - Đổi tên và sắp xếp vào `D:\FM_AUTO_OPS\Sales\` và `D:\FM_AUTO_OPS\Inventory\`.
   - Báo cáo kết quả thành công.
