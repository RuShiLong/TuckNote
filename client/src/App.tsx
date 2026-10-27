import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  BookOpen,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Inbox,
  LayoutDashboard,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { request, send, type Item, type ItemInput } from "./api";
import ItemEditor from "./ItemEditor";
import Vault from "./Vault";
import BackupSettings from "./BackupSettings";
import { useDialogKeyboard } from "./useDialogKeyboard";

type Page =
  | "dashboard"
  | "inbox"
  | "note"
  | "link"
  | "archive"
  | "trash"
  | "vault"
  | "settings";
const nav: { id: Page; title: string; icon: typeof Inbox }[] = [
  { id: "dashboard", title: "Tổng quan", icon: LayoutDashboard },
  { id: "inbox", title: "Inbox", icon: Inbox },
  { id: "note", title: "Ghi chú", icon: BookOpen },
  { id: "link", title: "Bộ sưu tập", icon: Link2 },
  { id: "vault", title: "Két bí mật", icon: LockKeyhole },
  { id: "archive", title: "Lưu trữ", icon: Archive },
  { id: "trash", title: "Thùng rác", icon: Trash2 },
  { id: "settings", title: "Cài đặt & sao lưu", icon: Settings },
];
const titles: Record<Page, string> = {
  dashboard: "Không gian của bạn",
  inbox: "Inbox",
  note: "Ghi chú",
  link: "Bộ sưu tập",
  archive: "Lưu trữ",
  trash: "Thùng rác",
  vault: "Két bí mật",
  settings: "Cài đặt & sao lưu",
};

export default function App() {
  const [auth, setAuth] = useState<"loading" | "setup" | "login" | "ready">(
    "loading",
  );
  const [email, setEmail] = useState("");
  const [page, setPage] = useState<Page>("dashboard");
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [groupName, setGroupName] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const requestId = useRef(0);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const yes = () => setOnline(true),
      no = () => setOnline(false),
      unauthorized = () => {
        setAuth("login");
        setSelected(null);
      };
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    window.addEventListener("tucknote:unauthorized", unauthorized);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
      window.removeEventListener("tucknote:unauthorized", unauthorized);
    };
  }, []);
  useEffect(() => {
    request<{ email: string }>("/auth/me")
      .then((x) => {
        setEmail(x.email);
        setAuth("ready");
      })
      .catch(async () => {
        try {
          const status = await request<{ needed: boolean }>(
            "/auth/setup-status",
          );
          setAuth(status.needed ? "setup" : "login");
        } catch {
          setError("Không kết nối được máy chủ.");
          setAuth("login");
        }
      });
  }, []);
  const itemParams = useCallback(
    (skip = 0) => {
      const params = new URLSearchParams();
      if (page === "inbox" || page === "note" || page === "link")
        params.set("kind", page);
      if (page === "archive" || page === "trash") params.set("status", page);
      if (query.trim()) params.set("q", query.trim());
      if (tag.trim()) params.set("tag", tag.trim());
      if (groupName.trim()) params.set("groupName", groupName.trim());
      if (after) params.set("after", new Date(after).toISOString());
      if (before)
        params.set("before", new Date(before + "T23:59:59").toISOString());
      params.set("skip", String(skip));
      return params;
    },
    [page, query, tag, groupName, after, before],
  );
  const load = useCallback(async () => {
    if (auth !== "ready" || page === "vault" || page === "settings") return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const batch = await request<Item[]>("/items?" + itemParams());
      if (requestId.current === id) {
        setItems(batch);
        setHasMore(batch.length === 100);
      }
    } catch (e) {
      if (requestId.current === id) setError((e as Error).message);
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [auth, page, itemParams, refresh]);
  const loadMore = async () => {
    if (loading || !hasMore) return;
    const id = requestId.current;
    setLoading(true);
    try {
      const batch = await request<Item[]>("/items?" + itemParams(items.length));
      if (requestId.current === id) {
        setItems((current) => [...current, ...batch]);
        setHasMore(batch.length === 100);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (auth !== "ready" || !online || items.length > 100) return;
    const timer = setInterval(() => setRefresh((x) => x + 1), 30_000);
    return () => clearInterval(timer);
  }, [auth, online, items.length]);
  const reload = useCallback(() => setRefresh((x) => x + 1), []);
  const choose = (next: Page) => {
    setPage(next);
    setSelected(null);
    setMobileOpen(false);
    setQuery("");
    setTag("");
    setGroupName("");
  };

  if (auth === "loading")
    return <div className="center-screen">Đang mở TuckNote…</div>;
  if (auth !== "ready")
    return (
      <AuthScreen
        mode={auth}
        error={error}
        onSuccess={(x) => {
          setEmail(x);
          setAuth("ready");
          setError("");
        }}
      />
    );

  return (
    <div className="shell">
      <aside className={"sidebar " + (mobileOpen ? "open" : "")}>
        <div className="brand">
          <span className="brand-mark">T</span>
          <span>
            TuckNote<small>Không gian riêng tư</small>
          </span>
          <button
            className="icon-button mobile-only"
            aria-label="Đóng menu"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="primary quick-sidebar"
          onClick={() => {
            setQuickOpen(true);
            setMobileOpen(false);
          }}
        >
          <Plus size={18} /> Lưu nhanh <span>Ctrl K</span>
        </button>
        <nav aria-label="Điều hướng chính">
          {nav.map(({ id, title, icon: Icon }) => (
            <button
              key={id}
              className={"nav-item " + (page === id ? "active" : "")}
              onClick={() => choose(id)}
            >
              <Icon size={19} />
              {title}
              {page === id && <ChevronRight size={15} className="chevron" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{email.slice(0, 1).toUpperCase()}</div>
          <span title={email}>{email}</span>
          <button
            aria-label="Đăng xuất"
            className="icon-button"
            onClick={async () => {
              try {
                await send("/auth/logout", {});
              } finally {
                setAuth("login");
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            aria-label="Mở menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={23} />
          </button>
          <div className="breadcrumb">
            Không gian cá nhân <ChevronRight size={14} />{" "}
            <strong>{titles[page]}</strong>
          </div>
          <div className="topbar-actions">
            {!online && (
              <span className="offline">
                <CloudOff size={16} /> Mất kết nối
              </span>
            )}
            <button
              className="icon-button"
              title="Lưu nhanh (Ctrl K)"
              aria-label="Lưu nhanh"
              onClick={() => setQuickOpen(true)}
            >
              <Plus size={20} />
            </button>
          </div>
        </header>
        <main>
          {page === "vault" ? (
            <Vault />
          ) : page === "settings" ? (
            <BackupSettings
              email={email}
              onSignedOut={() => setAuth("login")}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    TUCKNOTE / {titles[page].toUpperCase()}
                  </p>
                  <h1>{titles[page]}</h1>
                  <p className="subtitle">
                    {page === "dashboard"
                      ? "Mọi điều cần nhớ, trong một nơi gọn gàng."
                      : page === "trash"
                        ? "Khôi phục những mục đã xóa nhầm."
                        : page === "archive"
                          ? "Những mục bạn muốn giữ lại, nhưng tạm cất đi."
                          : "Lưu lại hôm nay, tìm thấy ngay khi cần."}
                  </p>
                </div>
                <button className="primary" onClick={() => setQuickOpen(true)}>
                  <Plus size={18} /> Lưu nhanh
                </button>
              </div>
              {page === "dashboard" && (
                <div className="welcome-grid">
                  <button onClick={() => choose("inbox")}>
                    <Inbox size={23} />
                    <strong>Ghi nhanh vào Inbox</strong>
                    <span>Ý tưởng, đường link và điều cần nhớ</span>
                    <ChevronRight size={17} />
                  </button>
                  <button onClick={() => choose("note")}>
                    <BookOpen size={23} />
                    <strong>Ghi chú của tôi</strong>
                    <span>Viết và sắp xếp nội dung</span>
                    <ChevronRight size={17} />
                  </button>
                  <button onClick={() => choose("vault")}>
                    <LockKeyhole size={23} />
                    <strong>Két bí mật</strong>
                    <span>Chỉ mở khi bạn cần</span>
                    <ChevronRight size={17} />
                  </button>
                </div>
              )}
              <section className="content-card">
                <div className="list-heading">
                  <div>
                    <h2>{page === "dashboard" ? "Gần đây" : titles[page]}</h2>
                    <p>{loading ? "Đang tải…" : `${items.length} mục`}</p>
                  </div>
                </div>
                <div className="filters">
                  <label className="search">
                    <Search size={18} />
                    <input
                      aria-label="Tìm kiếm"
                      placeholder="Tìm tiêu đề, nội dung, đường link…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <input
                    aria-label="Lọc theo thẻ"
                    placeholder="Lọc theo thẻ"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                  />
                  {page === "link" && (
                    <input
                      aria-label="Lọc theo nhóm chủ đề"
                      placeholder="Nhóm chủ đề"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                    />
                  )}
                  <label className="date-filter">
                    Từ{" "}
                    <input
                      type="date"
                      value={after}
                      onChange={(e) => setAfter(e.target.value)}
                    />
                  </label>
                  <label className="date-filter">
                    Đến{" "}
                    <input
                      type="date"
                      value={before}
                      onChange={(e) => setBefore(e.target.value)}
                    />
                  </label>
                </div>
                {error && (
                  <div className="notice error" role="alert">
                    {error} <button onClick={reload}>Thử lại</button>
                  </div>
                )}
                {!loading && !error && items.length === 0 && (
                  <div className="empty">
                    <div className="empty-icon">
                      <CircleHelp size={28} />
                    </div>
                    <h3>Chưa có mục nào</h3>
                    <p>
                      {query || tag
                        ? "Thử đổi từ khóa hoặc bộ lọc."
                        : "Nhấn “Lưu nhanh” để bắt đầu lưu điều quan trọng."}
                    </p>
                    <button
                      className="secondary"
                      onClick={() => setQuickOpen(true)}
                    >
                      <Plus size={16} /> Lưu nhanh
                    </button>
                  </div>
                )}
                <div className="item-list">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      className="item-row"
                      onClick={() => setSelected(item)}
                    >
                      <div className={"type-icon " + item.kind}>
                        {item.kind === "link" ? (
                          <Link2 size={18} />
                        ) : item.kind === "note" ? (
                          <BookOpen size={18} />
                        ) : (
                          <Inbox size={18} />
                        )}
                      </div>
                      <div className="item-text">
                        <strong>
                          {item.title ||
                            (item.kind === "link"
                              ? item.url
                              : "Không có tiêu đề")}
                        </strong>
                        <span>
                          {item.body || item.url || "Chưa có nội dung"}
                        </span>
                      </div>
                      <div className="item-meta">
                        {item.isPinned && <span className="pill">Ghim</span>}
                        <time>
                          {new Date(item.updatedAt).toLocaleDateString("vi-VN")}
                        </time>
                        <ChevronRight size={17} />
                      </div>
                    </button>
                  ))}
                </div>
                {hasMore && (
                  <div className="load-more">
                    <button
                      className="secondary"
                      disabled={loading}
                      onClick={loadMore}
                    >
                      {loading ? "Đang tải…" : "Xem thêm"}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
      {mobileOpen && (
        <button
          className="backdrop mobile-only"
          aria-label="Đóng menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {quickOpen && (
        <QuickCapture
          email={email}
          onClose={() => setQuickOpen(false)}
          onSaved={reload}
        />
      )}
      {selected && (
        <ItemEditor
          key={selected.id}
          item={selected}
          onClose={() => {
            setSelected(null);
            reload();
          }}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function AuthScreen({
  mode,
  error,
  onSuccess,
}: {
  mode: "setup" | "login";
  error: string;
  onSuccess: (email: string) => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [token, setToken] = useState(""),
    [message, setMessage] = useState(error),
    [busy, setBusy] = useState(false);
  useEffect(() => setMessage(error), [error]);
  return (
    <div className="auth-page">
      <div className="auth-visual">
        <div className="brand">
          <span className="brand-mark">T</span>
          <span>TuckNote</span>
        </div>
        <div>
          <p className="eyebrow">KHÔNG GIAN CÁ NHÂN</p>
          <h1>
            Ghi lại điều
            <br />
            đáng nhớ.
          </h1>
          <p>
            Ghi chú, đường link và thông tin bí mật của bạn, luôn trong tầm tay.
          </p>
        </div>
        <span>Một nơi cho mọi điều quan trọng.</span>
      </div>
      <div className="auth-form-wrap">
        <form
          className="auth-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              const result = await send<{ email: string }>(
                mode === "setup" ? "/auth/setup" : "/auth/login",
                mode === "setup"
                  ? { email, password, token }
                  : { email, password },
              );
              onSuccess(result.email);
            } catch (err) {
              setMessage((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="eyebrow">CHÀO MỪNG ĐẾN VỚI TUCKNOTE</span>
          <h2>{mode === "setup" ? "Thiết lập tài khoản" : "Đăng nhập"}</h2>
          <p>
            {mode === "setup"
              ? "Tạo tài khoản chủ sở hữu đầu tiên. Cần mã thiết lập từ cấu hình máy chủ."
              : "Tiếp tục vào không gian riêng của bạn."}
          </p>
          <label>
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              required
              minLength={mode === "setup" ? 12 : undefined}
              autoComplete={
                mode === "setup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode === "setup" && (
            <label>
              Mã thiết lập
              <input
                type="password"
                required
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          )}
          {message && (
            <div className="notice error" role="alert">
              {message}
            </div>
          )}
          <button className="primary full" disabled={busy}>
            {busy
              ? "Đang xử lý…"
              : mode === "setup"
                ? "Tạo tài khoản"
                : "Đăng nhập"}
          </button>
          <p className="form-help">
            Phiên tự khóa sau 30 phút không hoạt động.
          </p>
        </form>
      </div>
    </div>
  );
}

function QuickCapture({
  email,
  onClose,
  onSaved,
}: {
  email: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const draftKey = "tucknote:quick-draft:" + encodeURIComponent(email);
  const dialog = useDialogKeyboard<HTMLDivElement>(onClose);
  const [text, setText] = useState(localStorage.getItem(draftKey) || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    localStorage.setItem(draftKey, text);
  }, [draftKey, text]);
  const save = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const url = /^https?:\/\/\S+$/i.test(text.trim()) ? text.trim() : null;
      const input: ItemInput = {
        kind: "inbox",
        title: url
          ? new URL(url).hostname
          : text.trim().split("\n")[0].slice(0, 100),
        body: text,
        url: null,
        tags: "",
        group: "",
        isPinned: false,
        revision: 1,
      };
      await send("/items", input);
      localStorage.removeItem(draftKey);
      onSaved();
      onClose();
    } catch (e) {
      setError(
        (e as Error).message + " Nội dung vẫn được giữ trên thiết bị này.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal quick-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-title"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">GHI NHANH</p>
            <h2 id="quick-title">Điều gì đang trong đầu bạn?</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </div>
        <textarea
          data-autofocus
          placeholder="Viết ý tưởng, dán đường link hoặc ghi điều cần nhớ…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="modal-foot">
          <span>
            {error ||
              (text
                ? "Bản nháp được giữ trên thiết bị này."
                : "Mục mới sẽ vào Inbox.")}
          </span>
          <button
            className="primary"
            disabled={busy || !text.trim()}
            onClick={save}
          >
            {busy ? "Đang lưu…" : "Lưu vào Inbox"}
          </button>
        </div>
      </div>
    </div>
  );
}
