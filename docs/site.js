const screens = {
  dashboard: {
    breadcrumb: "Tổng quan",
    kicker: "TỔNG QUAN",
    title: "Không gian của bạn",
    description:
      "Một góc nhìn rõ ràng để bắt đầu và quay lại những điều quan trọng.",
    icon: "▦",
  },
  inbox: {
    breadcrumb: "Inbox",
    kicker: "GHI NHANH",
    title: "Inbox",
    description: "Ghi lại ngay, rồi phân loại khi bạn có thời gian.",
    icon: "▤",
    empty: "Mọi thứ bắt đầu ở Inbox",
    detail: "Văn bản và đường link được lưu nhanh sẽ chờ bạn sắp xếp ở đây.",
  },
  notes: {
    breadcrumb: "Ghi chú",
    kicker: "GHI CHÚ",
    title: "Ghi chú",
    description: "Viết, gắn thẻ, ghim và quay lại phiên bản cũ khi cần.",
    icon: "▣",
    empty: "Một nơi để viết và tìm lại",
    detail: "Nội dung ghi chú chỉ hiển thị trong tài khoản của chủ sở hữu.",
  },
  links: {
    breadcrumb: "Bộ sưu tập",
    kicker: "BỘ SƯU TẬP",
    title: "Bộ sưu tập",
    description: "Giữ đường link cùng mô tả, thẻ và nhóm chủ đề.",
    icon: "↗",
    empty: "Liên kết có ngữ cảnh",
    detail: "Nguồn tham khảo cá nhân không xuất hiện trong bản xem công khai.",
  },
  vault: {
    breadcrumb: "Két bí mật",
    kicker: "RIÊNG TƯ",
    title: "Két bí mật",
    description: "Khóa chính riêng và mã hóa trên thiết bị trước khi đồng bộ.",
    icon: "◇",
    empty: "Két luôn khóa trong bản xem",
    detail:
      "Không có mật khẩu hay dữ liệu két nào được tải lên trang công khai này.",
  },
  archive: {
    breadcrumb: "Lưu trữ",
    kicker: "SẮP XẾP",
    title: "Lưu trữ",
    description: "Đưa mục ít dùng ra khỏi không gian làm việc mà vẫn giữ lại.",
    icon: "▧",
    empty: "Gọn gàng mà không mất dấu",
    detail: "Các mục lưu trữ chỉ có trong ứng dụng sau đăng nhập.",
  },
  trash: {
    breadcrumb: "Thùng rác",
    kicker: "KHÔI PHỤC",
    title: "Thùng rác",
    description: "Khôi phục mục bị xóa nhầm khi bạn cần.",
    icon: "⌫",
    empty: "Có đường quay lại",
    detail: "Dữ liệu đã xóa không được đưa vào bản xem công khai.",
  },
  settings: {
    breadcrumb: "Cài đặt & sao lưu",
    kicker: "KIỂM SOÁT",
    title: "Cài đặt & sao lưu",
    description: "Quản lý phiên, mật khẩu và bản sao lưu được mã hóa.",
    icon: "⚙",
    empty: "Kiểm soát dữ liệu của bạn",
    detail: "Các thao tác tài khoản và sao lưu chỉ có trong ứng dụng thật.",
  },
};

const buttons = [...document.querySelectorAll("[data-screen]")];
const order = Object.keys(screens);
function selectScreen(key) {
  const screen = screens[key];
  if (!screen) return;
  for (const button of buttons) {
    const active = button.dataset.screen === key;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  document.getElementById("breadcrumb").textContent = screen.breadcrumb;
  document.getElementById("screen-kicker").textContent = screen.kicker;
  document.getElementById("screen-title").textContent = screen.title;
  document.getElementById("screen-description").textContent =
    screen.description;
  document.getElementById("screen-counter").textContent =
    `${String(order.indexOf(key) + 1).padStart(2, "0")} / 08`;
  document.getElementById("overview-grid").hidden = key !== "dashboard";
  document.getElementById("empty-panel").hidden = key === "dashboard";
  if (key !== "dashboard") {
    document.getElementById("empty-icon").textContent = screen.icon;
    document.getElementById("empty-title").textContent = screen.empty;
    document.getElementById("empty-description").textContent = screen.detail;
  }
}
for (const button of buttons)
  button.addEventListener("click", () => selectScreen(button.dataset.screen));
