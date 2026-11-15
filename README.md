# OmniFlow Studio (v1.0.0)
> **Nền tảng Tự động hóa & Trích xuất Dữ liệu ERP / POS Đa Doanh Nghiệp**

OmniFlow Studio là giải pháp phần mềm chuyên dụng tự động hóa quy trình nghiệp vụ vận hành, đối soát dữ liệu và xuất báo cáo tự động từ hệ thống bán lẻ POS (RPFO Retail Platform) và ERP chuyên sâu (SAP Business One SLD). Ứng dụng giúp loại bỏ hoàn toàn các thao tác thủ công lặp lại hàng ngày, giảm thiểu sai sót do con người, đồng thời tối ưu hóa tốc độ xuất dữ liệu đa chi nhánh với độ ổn định tuyệt đối.

---

## 🌟 Tính Năng Nổi Bật

### 1. Tự Động Hóa POS RPFO
- **Tải Data Doanh số tự động:** Hỗ trợ quét và trích xuất báo cáo doanh số theo từng ngày hoặc chuỗi ngày liên tục.
- **Tải Data Tồn kho đa điểm (Sloc ID):** Đồng bộ dữ liệu kho của toàn bộ chuỗi cửa hàng, kho tổng hoặc từng mã kho xác định chỉ với 1 cú click.
- **Wave Animation Retry & Smart Recovery:** Cơ chế tự động nhận diện trạng thái tải của giao diện DevExpress Web, tự hồi phục khi gặp nghẽn mạng hoặc timeout hệ thống, cam kết file xuất đầy đủ và toàn vẹn.

### 2. Tự Động Hóa SAP Business One SLD
- **Tự động đăng nhập & Điều hướng:** Tự động điền thông tin đăng nhập và điều hướng thẳng vào module nghiệp vụ cần trích xuất.
- **Tự động vượt cảnh báo trùng phiên (Take Over Session):** Tự phát hiện phiên làm việc đang hoạt động và chủ động Take Over mà không làm gián đoạn luồng tác vụ.
- **Bảo mật đa lớp tiêu chuẩn Enterprise:** Mật khẩu và thông tin tài khoản được mã hóa AES-256-GCM kết hợp phân vùng an toàn OS Vault (Windows Credential Manager / DPAPI), hoàn toàn không lưu trữ văn bản thuần (plain text).

### 3. Tùy Biến Đa Doanh Nghiệp (Enterprise Profiles)
- **Hỗ trợ không giới hạn hồ sơ doanh nghiệp:** Dễ dàng cấu hình và chuyển đổi qua lại giữa các công ty, thương hiệu hoặc chi nhánh khác nhau.
- **Cấu hình kho/cửa hàng linh hoạt:** Thêm, bớt, gán nhãn danh sách Sloc / Store ID một cách trực quan trên giao diện người dùng.
- **Đổi mẫu đặt tên file động (`namingTemplate`):** Hỗ trợ template linh hoạt dạng `{store}_{type}_{date}.xlsx` giúp phân loại báo cáo chuẩn xác, sẵn sàng nạp vào hệ thống BI hoặc kho lưu trữ kế toán.

### 4. Giao Diện Tối Giản, Siêu Tốc & Tối Ưu Tài Nguyên
- Thiết kế phẳng hiện đại, trực quan, 0 độ trễ (zero delay).
- Ứng dụng dồn 100% tài nguyên CPU/RAM cho động cơ tự động hóa Chromium Headless / Playwright, mang lại trải nghiệm mượt mà ngay cả trên máy trạm cấu hình phổ thông.

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Ứng Dụng

Người dùng có thể khởi chạy OmniFlow Studio theo một trong hai cách dưới đây:

### Cách 1: Tải Bản Đóng Gói (Khuyên Dùng Cho Người Dùng Cuối)
1. Truy cập mục **Releases** trên GitHub repository của dự án.
2. Tải về gói nén phiên bản mới nhất: `OmniFlow-Studio-v1.0.0-win64.zip`.
3. Giải nén thư mục tải về ra ổ đĩa máy tính (ví dụ: `D:\OmniFlow-Studio`).
4. Nhấp đúp vào file thực thi:
   ```text
   OmniFlow Studio.exe
   ```
   Ứng dụng sẽ tự động khởi động cùng toàn bộ dịch vụ ngầm đi kèm mà không cần cài đặt thêm môi trường phụ thuộc nào.

---

### Cách 2: Chạy Trực Tiếp Từ Mã Nguồn (Dành Cho Lập Trình Viên)
Yêu cầu môi trường: **Node.js (>= 18)** và **pnpm (>= 8)**.

1. **Clone repository:**
   ```bash
   git clone https://github.com/your-org/omniflow-studio.git
   cd omniflow-studio
   ```

2. **Cài đặt các gói phụ thuộc:**
   ```bash
   pnpm install
   ```

3. **Build toàn bộ dự án:**
   ```bash
   pnpm run build
   ```

4. **Khởi chạy ứng dụng:**
   ```bash
   pnpm start
   ```

---

## ⚙️ Hướng Dẫn Cấu Hình Ban Đầu

Sau khi mở ứng dụng lần đầu tiên, hãy thực hiện các bước cấu hình sau:

1. **Kiểm tra kết nối mạng:**
   - Đảm bảo máy tính đã được kết nối vào mạng nội bộ công ty hoặc đã bật **VPN** nội bộ để truy cập được vào máy chủ POS RPFO và SAP SLD.
2. **Cấu hình hồ sơ & Tài khoản:**
   - Vào mục **Cài đặt (Settings)** $\to$ Chọn **Quản lý Hồ sơ Doanh nghiệp (Enterprise Profiles)**.
   - Nhập thông tin tài khoản đăng nhập (Username / Password) cho hệ thống POS và SAP. Dữ liệu này sẽ được mã hóa an toàn ngay lập tức.
3. **Chọn thư mục lưu trữ mặc định:**
   - Thiết lập đường dẫn thư mục xuất báo cáo (ví dụ: `D:\BaoCaoDoanhThu_TonKho`).
   - Tùy chỉnh quy tắc đặt tên file nếu muốn áp dụng mẫu riêng cho phòng ban kế toán.

---

## 🛠️ Kiến Trúc Công Nghệ

```text
├── apps/
│   ├── local-agent/        # Core desktop runner & Chromium automation engine
│   └── web/                # Giao diện người dùng React + Tailwind CSS hiện đại
├── packages/
│   ├── browser-engine/     # Điều khiển Playwright / Chrome DevTools Protocol
│   ├── pos-adapter/        # Bộ chuyển đổi nghiệp vụ giao diện POS RPFO
│   ├── sap-adapter/        # Bộ chuyển đổi nghiệp vụ SAP Business One SLD
│   ├── security/           # Mã hóa AES-256 & Tích hợp OS Secure Vault
│   ├── file-engine/        # Xử lý, tổ chức và chuẩn hóa file Excel/CSV xuất ra
│   └── workflow-engine/    # Quản lý hàng đợi và điều phối luồng tác vụ song song
```

---

## 🤝 Đóng Góp & Phát Triển

Dự án hoan nghênh mọi đóng góp cải tiến từ cộng đồng lập trình viên:
1. Fork dự án về tài khoản cá nhân.
2. Tạo nhánh tính năng mới (`git checkout -b feature/AmazingFeature`).
3. Cam kết các thay đổi (`git commit -m 'feat: Add AmazingFeature'`).
4. Đẩy nhánh lên repository (`git push origin feature/AmazingFeature`).
5. Tạo một **Pull Request** mô tả chi tiết nội dung đã hoàn thiện.

---

## 📄 Giấy Phép (License)

Dự án được phân phối dưới giấy phép nội bộ độc quyền của doanh nghiệp (Internal Proprietary License) hoặc tuân thủ giấy phép nguồn mở của tổ chức sở hữu. Mọi hành vi sao chép trái phép hoặc phát tán không qua ủy quyền đều bị nghiêm cấm.
