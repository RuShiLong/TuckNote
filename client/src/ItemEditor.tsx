import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Archive,
  Clock3,
  Copy,
  ExternalLink,
  Pin,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { request, send, type Item, type ItemInput, type Version } from "./api";
import { useDialogKeyboard } from "./useDialogKeyboard";

const localKey = (id: string) => "tucknote:edit:" + id;
const toInput = (x: Item): ItemInput => ({
  kind: x.kind,
  title: x.title,
  body: x.body,
  url: x.url,
  tags: x.tags,
  group: x.group,
  isPinned: x.isPinned,
  revision: x.revision,
});

export default function ItemEditor({
  item,
  onClose,
  onChanged,
}: {
  item: Item;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialog = useDialogKeyboard<HTMLElement>(onClose);
  const [form, setForm] = useState<ItemInput>(() => {
    try {
      return JSON.parse(localStorage.getItem(localKey(item.id)) || "");
    } catch {
      return toInput(item);
    }
  });
  const [revision, setRevision] = useState(item.revision);
  const [dirty, setDirty] = useState(!!localStorage.getItem(localKey(item.id)));
  const [status, setStatus] = useState("Đã lưu");
  const [conflict, setConflict] = useState<Item | null>(null);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const sequence = useRef(0),
    saving = useRef(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const online = () => setRetry((x) => x + 1);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, []);
  const change = (patch: Partial<ItemInput>) => {
    setForm((x) => {
      const next = { ...x, ...patch };
      localStorage.setItem(localKey(item.id), JSON.stringify(next));
      return next;
    });
    sequence.current++;
    setDirty(true);
    setStatus("Chưa lưu");
  };
  useEffect(() => {
    if (!dirty || conflict || saving.current || item.deletedAt) return;
    const timer = setTimeout(async () => {
      saving.current = true;
      setStatus("Đang lưu…");
      const currentSeq = sequence.current;
      try {
        const saved = await send<Item>(
          "/items/" + item.id,
          { ...form, revision },
          "PUT",
        );
        setRevision(saved.revision);
        onChanged();
        if (currentSeq === sequence.current) {
          setDirty(false);
          setStatus("Đã lưu");
          localStorage.removeItem(localKey(item.id));
        }
      } catch (e) {
        const error = e as Error & { status?: number; current?: Item };
        if (error.status === 409) {
          try {
            setConflict(
              error.current || (await request<Item>(`/items/${item.id}`)),
            );
          } catch {
            setConflict(null);
          }
        }
        setStatus(
          error.status === 409
            ? "Xung đột chỉnh sửa"
            : "Lỗi lưu. Bản nháp vẫn ở thiết bị này.",
        );
      } finally {
        saving.current = false;
      }
    }, 850);
    return () => clearTimeout(timer);
  }, [
    form,
    revision,
    dirty,
    conflict,
    item.id,
    item.deletedAt,
    onChanged,
    retry,
  ]);
  const state = async (action: string) => {
    try {
      await send("/items/" + item.id + "/state", { action, revision });
      onClose();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const copy = async () => {
    try {
      await send("/items", {
        ...form,
        title: (form.title || "Không có tiêu đề") + " (bản sao)",
        revision: 1,
      });
      localStorage.removeItem(localKey(item.id));
      onClose();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const restoreVersion = async (number: number) => {
    try {
      const saved = await send<Item>(
        `/items/${item.id}/versions/${number}/restore`,
        { revision },
      );
      setRevision(saved.revision);
      setForm(toInput(saved));
      setVersions(null);
      localStorage.removeItem(localKey(item.id));
      setDirty(false);
      setStatus("Đã khôi phục");
      onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  return (
    <div
      className="modal-overlay editor-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="editor-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Chỉnh sửa mục"
      >
        <header className="editor-header">
          <div>
            <span className="eyebrow">
              {form.kind === "inbox"
                ? "INBOX"
                : form.kind === "note"
                  ? "GHI CHÚ"
                  : "BỘ SƯU TẬP"}
            </span>
            <span
              className={
                "save-status " +
                (status.includes("Lỗi") || status.includes("Xung đột")
                  ? "error-text"
                  : "")
              }
            >
              <Save size={14} />
              {status}
            </span>
          </div>
          <button className="icon-button" aria-label="Đóng" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {conflict && (
          <div className="notice error" role="alert">
            <strong>Mục này đã thay đổi trên thiết bị khác.</strong>
            <p>
              Bản nháp của bạn vẫn được giữ. Hãy lưu thành bản sao hoặc tải bản
              mới từ máy chủ.
            </p>
            <div className="button-row">
              <button className="secondary" onClick={copy}>
                <Copy size={16} /> Lưu bản sao
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setForm(toInput(conflict));
                  setRevision(conflict.revision);
                  setConflict(null);
                  setDirty(false);
                  localStorage.removeItem(localKey(item.id));
                  setStatus("Đã tải bản mới");
                }}
              >
                Tải bản mới
              </button>
            </div>
          </div>
        )}
        <div className="editor-scroll">
          <input
            data-autofocus
            className="title-input"
            aria-label="Tiêu đề"
            placeholder="Tiêu đề"
            maxLength={300}
            value={form.title}
            onChange={(e) => change({ title: e.target.value })}
            disabled={!!item.deletedAt}
          />
          <div className="editor-fields">
            <label>
              Loại mục
              <select
                value={form.kind}
                disabled={!!item.deletedAt}
                onChange={(e) => {
                  const kind = e.target.value as ItemInput["kind"];
                  change({
                    kind,
                    url:
                      kind === "link" &&
                      /^https?:\/\/\S+$/i.test(form.body.trim())
                        ? form.body.trim()
                        : form.url,
                  });
                }}
              >
                <option value="inbox">Inbox</option>
                <option value="note">Ghi chú</option>
                <option value="link">Link đã lưu</option>
              </select>
            </label>
            {form.kind === "link" && (
              <label>
                Đường link
                <input
                  type="url"
                  placeholder="https://"
                  value={form.url || ""}
                  onChange={(e) => change({ url: e.target.value })}
                />
              </label>
            )}
            <label>
              Thẻ, cách nhau bằng dấu phẩy
              <input
                value={form.tags}
                onChange={(e) => change({ tags: e.target.value })}
              />
            </label>
            <label>
              Nhóm chủ đề
              <input
                value={form.group}
                onChange={(e) => change({ group: e.target.value })}
              />
            </label>
          </div>
          <div className="editor-body-head">
            <label htmlFor="item-body">Nội dung</label>
            <div className="format-bar">
              <button
                title="In đậm"
                aria-label="In đậm"
                onClick={() => change({ body: form.body + "**chữ đậm**" })}
              >
                B
              </button>
              <button
                title="In nghiêng"
                aria-label="In nghiêng"
                onClick={() => change({ body: form.body + "*chữ nghiêng*" })}
              >
                <i>I</i>
              </button>
              <button
                title="Danh sách"
                aria-label="Danh sách"
                onClick={() => change({ body: form.body + "\n- mục mới" })}
              >
                ☷
              </button>
            </div>
          </div>
          <textarea
            id="item-body"
            className="body-input"
            value={form.body}
            onChange={(e) => change({ body: e.target.value })}
            disabled={!!item.deletedAt}
            placeholder="Viết ghi chú của bạn…"
          />
          <div className="preview">
            <span className="eyebrow">XEM TRƯỚC</span>
            <ReactMarkdown
              allowedElements={[
                "p",
                "strong",
                "em",
                "ul",
                "ol",
                "li",
                "code",
                "blockquote",
                "h1",
                "h2",
                "h3",
                "a",
                "br",
              ]}
              components={{
                a: ({ href, children }) => (
                  <a
                    href={
                      href?.startsWith("https://") ||
                      href?.startsWith("http://")
                        ? href
                        : "#"
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {form.body}
            </ReactMarkdown>
          </div>
          {versions && (
            <div className="version-list">
              <h3>Lịch sử phiên bản</h3>
              {versions.map((v) => (
                <div key={v.number}>
                  <span>
                    #{v.number} ·{" "}
                    {new Date(v.createdAt).toLocaleString("vi-VN")}
                  </span>
                  <button
                    className="text-button"
                    disabled={dirty}
                    onClick={() => restoreVersion(v.number)}
                  >
                    Khôi phục
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="editor-footer">
          <div className="button-row">
            {form.kind === "link" &&
              form.url &&
              /^https?:\/\//i.test(form.url) && (
                <button
                  className="secondary"
                  onClick={() =>
                    window.open(form.url!, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={16} /> Mở link
                </button>
              )}
            <button
              className="secondary"
              disabled={dirty || !!item.deletedAt}
              onClick={async () => {
                try {
                  setVersions(
                    await request<Version[]>(`/items/${item.id}/versions`),
                  );
                } catch (e) {
                  setStatus((e as Error).message);
                }
              }}
            >
              <Clock3 size={16} /> Lịch sử
            </button>
            <button className="secondary" onClick={copy}>
              <Copy size={16} /> Bản sao
            </button>
          </div>
          <div className="button-row">
            {item.deletedAt ? (
              <button className="secondary" onClick={() => state("restore")}>
                <RotateCcw size={16} /> Khôi phục
              </button>
            ) : (
              <>
                <button
                  className="secondary"
                  disabled={dirty}
                  onClick={() => state(form.isPinned ? "unpin" : "pin")}
                >
                  <Pin size={16} />
                  {form.isPinned ? "Bỏ ghim" : "Ghim"}
                </button>
                <button
                  className="secondary"
                  disabled={dirty}
                  onClick={() =>
                    state(item.archivedAt ? "unarchive" : "archive")
                  }
                >
                  <Archive size={16} />
                  {item.archivedAt ? "Bỏ lưu trữ" : "Lưu trữ"}
                </button>
                <button
                  className="danger-button"
                  disabled={dirty}
                  onClick={() => state("delete")}
                >
                  <Trash2 size={16} /> Xóa
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
