import { useEffect, useState } from "react";
import { Download, KeyRound, ShieldCheck, Upload, Users } from "lucide-react";
import { request, send } from "./api";
import { decryptBackup, encryptBackup } from "./crypto";

type Session = {
  id: string;
  device: string;
  createdAt: string;
  lastSeenAt: string;
};
export default function BackupSettings({
  email,
  onSignedOut,
}: {
  email: string;
  onSignedOut: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState("");
  const [backupPassword, setBackupPassword] = useState(""),
    [restorePassword, setRestorePassword] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const load = () =>
    request<Session[]>("/auth/sessions")
      .then(setSessions)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    load();
  }, []);
  const changePassword = async () => {
    setBusy(true);
    setError("");
    try {
      await send("/auth/password", { current, newPassword: next });
      onSignedOut();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportData = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const snapshot = await request<unknown>("/backup/snapshot");
      const encrypted = await encryptBackup(backupPassword, snapshot);
      const blob = new Blob([JSON.stringify(encrypted)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = `TuckNote-${new Date().toISOString().slice(0, 10)}.encrypted.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupPassword("");
      setMessage("Đã xuất bản sao lưu được mã hóa.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importData = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (file.size > 25_000_000)
        throw new Error("Tệp sao lưu quá lớn (tối đa 25 MB).");
      const backup = JSON.parse(await file.text());
      const snapshot = await decryptBackup(restorePassword, backup);
      const result = await send<{ imported: number }>(
        "/backup/restore",
        snapshot,
      );
      setMessage(`Đã nhập ${result.imported} mục. Các mục cũ vẫn được giữ.`);
      setFile(null);
      setRestorePassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TUCKNOTE / TÀI KHOẢN</p>
          <h1>Cài đặt & sao lưu</h1>
          <p className="subtitle">
            Kiểm soát tài khoản, phiên đăng nhập và dữ liệu của bạn.
          </p>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      <div className="settings-grid">
        <section className="content-card setting-card">
          <div className="section-icon">
            <ShieldCheck size={20} />
          </div>
          <h2>Tài khoản</h2>
          <p>Đăng nhập với {email}</p>
          <label>
            Mật khẩu hiện tại
            <input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            Mật khẩu mới
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || next.length < 12}
            onClick={changePassword}
          >
            <KeyRound size={16} /> Đổi mật khẩu
          </button>
          <p className="hint">Đổi mật khẩu sẽ đăng xuất tất cả thiết bị.</p>
        </section>
        <section className="content-card setting-card">
          <div className="section-icon">
            <Users size={20} />
          </div>
          <h2>Phiên đăng nhập</h2>
          <p>Thu hồi quyền truy cập trên thiết bị không còn sử dụng.</p>
          {sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <div>
                <strong>{s.device || "Thiết bị không xác định"}</strong>
                <span>
                  Hoạt động: {new Date(s.lastSeenAt).toLocaleString("vi-VN")}
                </span>
              </div>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await request(`/auth/sessions/${s.id}`, {
                      method: "DELETE",
                    });
                    load();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Thu hồi
              </button>
            </div>
          ))}
        </section>
        <section className="content-card setting-card">
          <div className="section-icon">
            <Download size={20} />
          </div>
          <h2>Xuất bản sao lưu</h2>
          <p>
            Toàn bộ tệp xuất được mã hóa bằng mật khẩu riêng. Két vẫn giữ mã hóa
            đầu cuối bên trong bản sao lưu.
          </p>
          <label>
            Mật khẩu cho bản sao lưu
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={backupPassword}
              onChange={(e) => setBackupPassword(e.target.value)}
              placeholder="Ít nhất 12 ký tự"
            />
          </label>
          <button
            className="primary"
            disabled={busy || backupPassword.length < 12}
            onClick={exportData}
          >
            <Download size={16} /> Tải bản sao lưu
          </button>
          <p className="hint">
            Giữ mật khẩu sao lưu và recovery key của két ở nơi an toàn.
          </p>
        </section>
        <section className="content-card setting-card">
          <div className="section-icon">
            <Upload size={20} />
          </div>
          <h2>Nhập bản sao lưu</h2>
          <p>
            Các ghi chú được nhập thành bản mới. Nếu tài khoản đã có két, không
            thể nhập một két dùng khóa khác.
          </p>
          <label>
            Chọn tệp .encrypted.json
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <label>
            Mật khẩu bản sao lưu
            <input
              type="password"
              autoComplete="off"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || !file || !restorePassword}
            onClick={importData}
          >
            <Upload size={16} /> Khôi phục dữ liệu
          </button>
        </section>
      </div>
    </>
  );
}
