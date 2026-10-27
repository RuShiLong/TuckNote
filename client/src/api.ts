export type Item = {
  id: string;
  kind: "inbox" | "note" | "link";
  title: string;
  body: string;
  url: string | null;
  tags: string;
  group: string;
  isPinned: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archivedAt: string | null;
};
export type ItemInput = Pick<
  Item,
  "kind" | "title" | "body" | "url" | "tags" | "group" | "isPinned" | "revision"
>;
export type Version = {
  number: number;
  title: string;
  body: string;
  url: string | null;
  tags: string;
  group: string;
  createdAt: string;
};
export type VaultProfile = {
  salt: string;
  iterations: number;
  wrappedKey: string;
  masterIv: string;
  recoveryWrappedKey: string;
  recoveryIv: string;
};
export type VaultEntry = {
  id: string;
  ciphertext: string;
  iv: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
};

let csrf = "";
export async function request<T>(
  path: string,
  options: RequestInit = {},
  retriedCsrf = false,
): Promise<T> {
  if (!csrf) {
    const response = await fetch("/api/csrf", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Không lấy được mã bảo vệ phiên.");
    csrf = (await response.json()).token;
  }
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-TOKEN": csrf,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const raw = await response.text();
    if (response.status === 400 && !raw && !retriedCsrf && options.method) {
      csrf = "";
      return request<T>(path, options, true);
    }
    if (response.status === 401) {
      csrf = "";
      if (path !== "/auth/me")
        window.dispatchEvent(new Event("tucknote:unauthorized"));
    }
    let detail: { error?: string; current?: Item } = {};
    try {
      detail = JSON.parse(raw);
    } catch {
      /* error body may be empty */
    }
    const error = new Error(
      detail.error ||
        (response.status === 409
          ? "Xung đột chỉnh sửa."
          : `Lỗi ${response.status}`),
    ) as Error & { status?: number; current?: Item };
    error.status = response.status;
    error.current = detail.current;
    throw error;
  }
  if (
    path === "/auth/login" ||
    path === "/auth/setup" ||
    path === "/auth/logout" ||
    path === "/auth/password"
  )
    csrf = "";
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}
export const send = <T>(path: string, body: unknown, method = "POST") =>
  request<T>(path, { method, body: JSON.stringify(body) });
