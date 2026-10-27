import type { VaultProfile } from "./api";

const enc = new TextEncoder();
const dec = new TextDecoder();
const random = (n: number): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(n));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const bytes = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const aes = (raw: BufferSource) =>
  crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
const derive = async (
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
) => {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};
const wrap = async (key: CryptoKey, raw: Uint8Array<ArrayBuffer>) => {
  const iv = random(12);
  return {
    iv: b64(iv),
    ciphertext: b64(
      new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, raw),
      ),
    ),
  };
};
const unwrap = (key: CryptoKey, iv: string, ciphertext: string) =>
  crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes(iv) },
    key,
    bytes(ciphertext),
  );

export async function createVault(
  master: string,
): Promise<{ profile: VaultProfile; recoveryKey: string; key: CryptoKey }> {
  if (master.length < 12)
    throw new Error("Mật khẩu chính cần ít nhất 12 ký tự.");
  const raw = random(32),
    salt = random(16),
    recovery = random(32),
    iterations = 600000;
  const main = await wrap(await derive(master, salt, iterations), raw);
  const rescue = await wrap(await aes(recovery), raw);
  return {
    key: await aes(raw),
    recoveryKey: b64(recovery),
    profile: {
      salt: b64(salt),
      iterations,
      wrappedKey: main.ciphertext,
      masterIv: main.iv,
      recoveryWrappedKey: rescue.ciphertext,
      recoveryIv: rescue.iv,
    },
  };
}
export async function unlockVault(
  profile: VaultProfile,
  password: string,
): Promise<CryptoKey> {
  if (profile.iterations < 600000 || profile.iterations > 2000000)
    throw new Error("Tham số KDF không hợp lệ.");
  const raw = await unwrap(
    await derive(password, bytes(profile.salt), profile.iterations),
    profile.masterIv,
    profile.wrappedKey,
  );
  return aes(raw);
}
export async function recoverVault(
  profile: VaultProfile,
  recoveryKey: string,
): Promise<CryptoKey> {
  const raw = await unwrap(
    await aes(bytes(recoveryKey)),
    profile.recoveryIv,
    profile.recoveryWrappedKey,
  );
  return aes(raw);
}
export async function encryptJson(key: CryptoKey, value: unknown) {
  const iv = random(12);
  return {
    iv: b64(iv),
    ciphertext: b64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          enc.encode(JSON.stringify(value)),
        ),
      ),
    ),
  };
}
export async function decryptJson<T>(
  key: CryptoKey,
  value: { iv: string; ciphertext: string },
): Promise<T> {
  return JSON.parse(
    dec.decode(await unwrap(key, value.iv, value.ciphertext)),
  ) as T;
}
export async function encryptBackup(password: string, snapshot: unknown) {
  if (password.length < 12)
    throw new Error("Mật khẩu sao lưu cần ít nhất 12 ký tự.");
  const salt = random(16),
    iterations = 600000;
  return {
    format: "tucknote-encrypted-v1",
    salt: b64(salt),
    iterations,
    ...(await encryptJson(await derive(password, salt, iterations), snapshot)),
  };
}
export async function decryptBackup(
  password: string,
  backup: {
    format: string;
    salt: string;
    iterations: number;
    iv: string;
    ciphertext: string;
  },
) {
  if (
    backup.format !== "tucknote-encrypted-v1" ||
    backup.iterations < 600000 ||
    backup.iterations > 2000000
  )
    throw new Error("Tệp sao lưu không hợp lệ.");
  return decryptJson<unknown>(
    await derive(password, bytes(backup.salt), backup.iterations),
    backup,
  );
}
export function generatePassword(length = 24) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const out: string[] = [];
  while (out.length < length) {
    const b = random(1)[0];
    if (b < Math.floor(256 / chars.length) * chars.length)
      out.push(chars[b % chars.length]);
  }
  return out.join("");
}
