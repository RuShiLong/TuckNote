import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { request, send, type VaultEntry, type VaultProfile } from "./api";
import {
  createVault,
  decryptJson,
  encryptJson,
  generatePassword,
  recoverVault,
  unlockVault,
} from "./crypto";
import { useDialogKeyboard } from "./useDialogKeyboard";

type Secret = {
  name: string;
  website: string;
  username: string;
  password: string;
  notes: string;
  custom: { label: string; value: string }[];
};
const empty = (): Secret => ({
  name: "",
  website: "",
  username: "",
  password: "",
  notes: "",
  custom: [],
});
type OpenEntry = { record: VaultEntry; secret: Secret };
type Pending = {
  draftId: string;
  entryId?: string;
  revision: number;
  ciphertext: string;
  iv: string;
};

export default function Vault() {
  const [profile, setProfile] = useState<VaultProfile | null | undefined>(
    undefined,
  );
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [entries, setEntries] = useState<OpenEntry[]>([]);
  const [master, setMaster] = useState(""),
    [recoveryInput, setRecoveryInput] = useState(""),
    [useRecovery, setUseRecovery] = useState(false);
  const [staged, setStaged] = useState<Awaited<
    ReturnType<typeof createVault>
  > | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<OpenEntry | null>(null),
    [creating, setCreating] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const completedDrafts = useRef(new Set<string>());
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useCallback(() => {
    setKey(null);
    setEntries([]);
    setSelected(null);
    setCreating(false);
    setMaster("");
    setRecoveryInput("");
    setQuery("");
  }, []);
  useEffect(() => {
    request<VaultProfile | null>("/vault/profile")
      .then((x) => {
        setProfile(x);
        if (x) {
          try {
            setPending(
              JSON.parse(
                localStorage.getItem("tucknote:vault:pending:" + x.salt) ||
                  "[]",
              ),
            );
          } catch {
            setPending([]);
          }
        }
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  const updatePending = (change: (all: Pending[]) => Pending[]) =>
    setPending((all) => {
      const next = change(all);
      if (profile)
        localStorage.setItem(
          "tucknote:vault:pending:" + profile.salt,
          JSON.stringify(next),
        );
      return next;
    });
  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, 5 * 60 * 1000);
    };
    const hidden = () => {
      if (document.hidden) lock();
    };
    for (const name of ["pointerdown", "keydown", "touchstart"])
      window.addEventListener(name, reset);
    document.addEventListener("visibilitychange", hidden);
    reset();
    return () => {
      clearTimeout(timer);
      for (const name of ["pointerdown", "keydown", "touchstart"])
        window.removeEventListener(name, reset);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [key, lock]);
  const loadEntries = async (activeKey: CryptoKey) => {
    const [active, trash] = await Promise.all([
      request<VaultEntry[]>("/vault/entries"),
      request<VaultEntry[]>("/vault/trash"),
    ]);
    const records = [...active, ...trash];
    const result: OpenEntry[] = [];
    for (const record of records) {
      try {
        result.push({
          record,
          secret: await decryptJson<Secret>(activeKey, record),
        });
      } catch {
        setError(
          "Có mục két không giải mã được. Dữ liệu có thể đã bị sửa hoặc dùng khóa khác.",
        );
      }
    }
    setEntries(result);
  };
  const setup = async () => {
    setBusy(true);
    setError("");
    try {
      setStaged(await createVault(master));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const finishSetup = async () => {
    if (!staged || !confirmed) return;
    setBusy(true);
    try {
      await send("/vault/profile", staged.profile);
      setProfile(staged.profile);
      setKey(staged.key);
      setStaged(null);
      setMaster("");
      setConfirmed(false);
      await loadEntries(staged.key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unlock = async () => {
    if (!profile) return;
    setBusy(true);
    setError("");
    try {
      const activeKey = useRecovery
        ? await recoverVault(profile, recoveryInput.trim())
        : await unlockVault(profile, master);
      await loadEntries(activeKey);
      setKey(activeKey);
      setMaster("");
      setRecoveryInput("");
    } catch {
      setError("Không mở được két. Kiểm tra mật khẩu chính hoặc recovery key.");
    } finally {
      setBusy(false);
    }
  };
  const save = async (
    secret: Secret,
    current?: OpenEntry,
    draftId: string = crypto.randomUUID(),
    expectedRevision?: number,
  ) => {
    if (!key) return;
    if (!secret.name.trim()) {
      setError("Nhập tên mục két.");
      return;
    }
    if (secret.website && !/^https?:\/\/\S+$/i.test(secret.website)) {
      setError("Website phải dùng http hoặc https.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const encrypted = await encryptJson(key, secret);
      const revision = expectedRevision ?? current?.record.revision ?? 1;
      updatePending((all) => [
        ...all.filter((x) => x.draftId !== draftId),
        { draftId, entryId: current?.record.id, revision, ...encrypted },
      ]);
      if (current)
        await send(
          `/vault/entries/${current.record.id}`,
          { ...encrypted, revision },
          "PUT",
        );
      else await send("/vault/entries", { ...encrypted, revision: 1 });
      completedDrafts.current.add(draftId);
      updatePending((all) => all.filter((x) => x.draftId !== draftId));
      setSelected(null);
      setCreating(false);
      await loadEntries(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const storeDraft = async (
    secret: Secret,
    draftId: string,
    current?: OpenEntry,
  ) => {
    if (!key || completedDrafts.current.has(draftId)) return;
    try {
      const encrypted = await encryptJson(key, secret);
      if (completedDrafts.current.has(draftId)) return;
      updatePending((all) => [
        ...all.filter((x) => x.draftId !== draftId),
        {
          draftId,
          entryId: current?.record.id,
          revision: current?.record.revision ?? 1,
          ...encrypted,
        },
      ]);
    } catch {
      setError("Không lưu được bản nháp két trên thiết bị này.");
    }
  };
  const remove = async (entry: OpenEntry) => {
    if (!key || !confirm("Xóa mục két này?")) return;
    setBusy(true);
    try {
      await request(
        `/vault/entries/${entry.record.id}?revision=${entry.record.revision}`,
        { method: "DELETE" },
      );
      setSelected(null);
      await loadEntries(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (entry: OpenEntry) => {
    if (!key) return;
    setBusy(true);
    try {
      await send(`/vault/entries/${entry.record.id}/restore`, {
        revision: entry.record.revision,
      });
      setSelected(null);
      await loadEntries(key);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const retryPending = async (draft: Pending, asCopy = false) => {
    if (!key) return;
    try {
      const secret = await decryptJson<Secret>(key, draft);
      const current = asCopy
        ? undefined
        : entries.find((x) => x.record.id === draft.entryId);
      if (draft.entryId && !current && !asCopy)
        throw new Error("Mục gốc không còn. Hãy lưu bản sao.");
      await save(secret, current, draft.draftId, asCopy ? 1 : draft.revision);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const visible = entries.filter(
    (x) =>
      !!x.record.deletedAt === showTrash &&
      [x.secret.name, x.secret.website, x.secret.username, x.secret.notes]
        .join(" ")
        .toLocaleLowerCase("vi")
        .includes(query.toLocaleLowerCase("vi")),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">TUCKNOTE / BẢO MẬT</p>
          <h1>Két bí mật</h1>
          <p className="subtitle">
            Nội dung được mã hóa trên thiết bị trước khi đồng bộ.
          </p>
        </div>
        {key && (
          <div className="button-row">
            <button className="secondary" onClick={lock}>
              <LockKeyhole size={17} /> Khóa két
            </button>
            <button className="primary" onClick={() => setCreating(true)}>
              <Plus size={17} /> Thêm mục
            </button>
          </div>
        )}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {profile === undefined ? (
        <div className="content-card loading-card">Đang tải két…</div>
      ) : !profile ? (
        <div className="vault-gate content-card">
          <div className="gate-icon">
            <ShieldCheck size={31} />
          </div>
          <h2>Thiết lập két bí mật</h2>
          <p>
            Mật khẩu chính của két phải khác mật khẩu đăng nhập. Chúng tôi không
            thể khôi phục dữ liệu nếu bạn mất cả mật khẩu chính lẫn recovery
            key.
          </p>
          {staged ? (
            <>
              <div className="recovery-box">
                <strong>Recovery key — lưu vào nơi an toàn ngay bây giờ</strong>
                <code>{staged.recoveryKey}</code>
                <button
                  className="secondary"
                  onClick={() =>
                    navigator.clipboard.writeText(staged.recoveryKey)
                  }
                >
                  <Copy size={16} /> Sao chép
                </button>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                Tôi đã lưu recovery key ở nơi an toàn.
              </label>
              <button
                className="primary"
                disabled={!confirmed || busy}
                onClick={finishSetup}
              >
                Hoàn tất thiết lập
              </button>
            </>
          ) : (
            <>
              <label>
                Mật khẩu chính
                <input
                  type="password"
                  value={master}
                  minLength={12}
                  autoComplete="new-password"
                  onChange={(e) => setMaster(e.target.value)}
                  placeholder="Ít nhất 12 ký tự"
                />
              </label>
              <button
                className="primary"
                disabled={busy || master.length < 12}
                onClick={setup}
              >
                Tạo két và recovery key
              </button>
            </>
          )}
        </div>
      ) : !key ? (
        <div className="vault-gate content-card">
          <div className="gate-icon">
            <LockKeyhole size={31} />
          </div>
          <h2>Két đang khóa</h2>
          <p>
            Nhập mật khẩu chính hoặc recovery key để giải mã trên thiết bị này.
            Két tự khóa sau 5 phút không hoạt động hoặc khi rời tab.
          </p>
          <label>
            {useRecovery ? "Recovery key" : "Mật khẩu chính"}
            <input
              type="password"
              autoComplete="off"
              value={useRecovery ? recoveryInput : master}
              onChange={(e) =>
                useRecovery
                  ? setRecoveryInput(e.target.value)
                  : setMaster(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") unlock();
              }}
            />
          </label>
          <button className="primary" disabled={busy} onClick={unlock}>
            {busy ? "Đang mở…" : "Mở két"}
          </button>
          <button
            className="text-button"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setError("");
            }}
          >
            {useRecovery ? "Dùng mật khẩu chính" : "Dùng recovery key"}
          </button>
        </div>
      ) : (
        <section className="content-card">
          <div className="list-heading">
            <div>
              <h2>{showTrash ? "Thùng rác của két" : "Mục đã lưu"}</h2>
              <p>{visible.length} mục · tìm kiếm chỉ thực hiện trên thiết bị</p>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setShowTrash(!showTrash);
                setSelected(null);
              }}
            >
              {showTrash ? "Quay lại két" : "Thùng rác"}
            </button>
          </div>
          <label className="search vault-search">
            <Search size={18} />
            <input
              aria-label="Tìm trong két"
              placeholder="Tìm tên, website, username…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {visible.length === 0 && (
            <div className="empty">
              <KeyRound size={30} />
              <h3>Không tìm thấy mục nào</h3>
              <p>
                {showTrash
                  ? "Chưa có mục nào bị xóa."
                  : "Thêm mật khẩu đầu tiên hoặc đổi từ khóa tìm kiếm."}
              </p>
            </div>
          )}
          <div className="item-list">
            {visible.map((x) => (
              <button
                className="item-row"
                key={x.record.id}
                onClick={() => setSelected(x)}
              >
                <div className="type-icon vault">
                  <KeyRound size={18} />
                </div>
                <div className="item-text">
                  <strong>{x.secret.name}</strong>
                  <span>
                    {x.secret.website || x.secret.username || "Mục bí mật"}
                  </span>
                </div>
                <span className="item-meta">
                  {showTrash ? "Khôi phục" : "Sửa"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      {key && pending.length > 0 && (
        <div className="content-card pending-card" role="status">
          <h3>{pending.length} chỉnh sửa két chưa đồng bộ</h3>
          <p>
            Các bản nháp này được mã hóa trên thiết bị. Nếu gặp xung đột, hãy
            lưu thành bản sao.
          </p>
          {pending.map((draft) => (
            <div className="pending-row" key={draft.draftId}>
              <span>{draft.entryId ? "Mục đã sửa" : "Mục mới"}</span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => retryPending(draft)}
              >
                Thử đồng bộ
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => retryPending(draft, true)}
              >
                Lưu bản sao
              </button>
            </div>
          ))}
        </div>
      )}
      {key && (creating || selected) && (
        <SecretEditor
          key={selected?.record.id || "new"}
          initial={selected?.secret || empty()}
          busy={busy}
          onClose={() => {
            setSelected(null);
            setCreating(false);
          }}
          onSave={(s, draftId) => save(s, selected || undefined, draftId)}
          onCopy={
            selected ? (s, draftId) => save(s, undefined, draftId) : undefined
          }
          onDraft={(s, draftId) =>
            storeDraft(s, draftId, selected || undefined)
          }
          onDelete={
            selected && !selected.record.deletedAt
              ? () => remove(selected)
              : undefined
          }
          onRestore={
            selected?.record.deletedAt ? () => restore(selected) : undefined
          }
        />
      )}
    </>
  );
}

function SecretEditor({
  initial,
  busy,
  onClose,
  onSave,
  onCopy,
  onDraft,
  onDelete,
  onRestore,
}: {
  initial: Secret;
  busy: boolean;
  onClose: () => void;
  onSave: (s: Secret, draftId: string) => void;
  onCopy?: (s: Secret, draftId: string) => void;
  onDraft: (s: Secret, draftId: string) => void;
  onDelete?: () => void;
  onRestore?: () => void;
}) {
  const dialog = useDialogKeyboard<HTMLDivElement>(onClose);
  const [form, setForm] = useState<Secret>(initial),
    [reveal, setReveal] = useState(false);
  const [dirty, setDirty] = useState(false);
  const draftId = useRef(crypto.randomUUID());
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const latest = useRef({ form, dirty, onDraft });
  latest.current = { form, dirty, onDraft };
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(
      () => onDraftRef.current(form, draftId.current),
      400,
    );
    return () => clearTimeout(timer);
  }, [form, dirty]);
  useEffect(
    () => () => {
      if (latest.current.dirty)
        latest.current.onDraft(latest.current.form, draftId.current);
    },
    [],
  );
  const change = (patch: Partial<Secret>) => {
    setForm((x) => ({ ...x, ...patch }));
    setDirty(true);
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
        className="modal secret-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Mục két"
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">KÉT BÍ MẬT</p>
            <h2>
              {onRestore
                ? "Mục đã xóa"
                : onDelete
                  ? "Chỉnh sửa mục"
                  : "Thêm mục mới"}
            </h2>
          </div>
          <button className="icon-button" aria-label="Đóng" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="secret-fields">
          <label>
            Tên mục
            <input
              data-autofocus
              value={form.name}
              maxLength={200}
              onChange={(e) => change({ name: e.target.value })}
            />
          </label>
          <label>
            Website
            <input
              type="url"
              placeholder="https://"
              value={form.website}
              onChange={(e) => change({ website: e.target.value })}
            />
          </label>
          <label>
            Username
            <input
              value={form.username}
              autoComplete="off"
              onChange={(e) => change({ username: e.target.value })}
            />
          </label>
          <label>
            Mật khẩu
            <div className="inline-input">
              <input
                type={reveal ? "text" : "password"}
                value={form.password}
                autoComplete="new-password"
                onChange={(e) => change({ password: e.target.value })}
              />
              <button
                className="icon-button"
                aria-label={reveal ? "Che mật khẩu" : "Hiện mật khẩu"}
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <button
                className="icon-button"
                aria-label="Sao chép mật khẩu"
                onClick={() => navigator.clipboard.writeText(form.password)}
              >
                <Copy size={18} />
              </button>
            </div>
          </label>
          <button
            className="text-button"
            onClick={() => change({ password: generatePassword() })}
          >
            <RefreshCw size={15} /> Tạo mật khẩu mạnh
          </button>
          <label>
            Ghi chú bí mật
            <textarea
              value={form.notes}
              onChange={(e) => change({ notes: e.target.value })}
            />
          </label>
          <div className="custom-fields">
            <strong>Trường tùy chỉnh</strong>
            {form.custom.map((field, i) => (
              <div className="custom-row" key={i}>
                <input
                  aria-label="Tên trường"
                  placeholder="Tên trường"
                  value={field.label}
                  onChange={(e) =>
                    change({
                      custom: form.custom.map((v, j) =>
                        j === i ? { ...v, label: e.target.value } : v,
                      ),
                    })
                  }
                />
                <input
                  aria-label="Giá trị trường"
                  placeholder="Giá trị"
                  value={field.value}
                  onChange={(e) =>
                    change({
                      custom: form.custom.map((v, j) =>
                        j === i ? { ...v, value: e.target.value } : v,
                      ),
                    })
                  }
                />
                <button
                  className="icon-button"
                  aria-label="Xóa trường"
                  onClick={() =>
                    change({ custom: form.custom.filter((_, j) => j !== i) })
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() =>
                change({ custom: [...form.custom, { label: "", value: "" }] })
              }
            >
              <Plus size={15} /> Thêm trường
            </button>
          </div>
        </div>
        <div className="modal-foot">
          {form.website && /^https?:\/\//i.test(form.website) && (
            <button
              className="secondary"
              onClick={() =>
                window.open(form.website, "_blank", "noopener,noreferrer")
              }
            >
              <ExternalLink size={16} /> Mở website
            </button>
          )}
          {onDelete && (
            <button className="danger-button" onClick={onDelete}>
              <Trash2 size={16} /> Xóa
            </button>
          )}
          {onCopy && !onRestore && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => onCopy(form, draftId.current)}
            >
              <Copy size={16} /> Lưu bản sao
            </button>
          )}
          {onRestore ? (
            <button className="primary" disabled={busy} onClick={onRestore}>
              Khôi phục
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy}
              onClick={() => onSave(form, draftId.current)}
            >
              {busy ? "Đang lưu…" : "Lưu mã hóa"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
