import { describe, expect, it } from "vitest";
import {
  createVault,
  decryptBackup,
  decryptJson,
  encryptBackup,
  encryptJson,
  generatePassword,
  recoverVault,
  unlockVault,
} from "./crypto";

describe("két bí mật", () => {
  it("mã hóa, giải mã, khóa sai và dữ liệu bị sửa", async () => {
    const created = await createVault("a very strong master passphrase");
    const data = {
      name: "Email",
      website: "https://example.test",
      username: "owner",
      password: generatePassword(),
      notes: "private",
    };
    const ciphertext = await encryptJson(created.key, data);
    expect(JSON.stringify(ciphertext)).not.toContain("owner");
    expect(await decryptJson(created.key, ciphertext)).toEqual(data);
    const unlocked = await unlockVault(
      created.profile,
      "a very strong master passphrase",
    );
    expect(await decryptJson(unlocked, ciphertext)).toEqual(data);
    const rescued = await recoverVault(created.profile, created.recoveryKey);
    expect(await decryptJson(rescued, ciphertext)).toEqual(data);
    await expect(
      unlockVault(created.profile, "wrong password"),
    ).rejects.toThrow();
    await expect(
      recoverVault(created.profile, createVaultKey()),
    ).rejects.toThrow();
    const raw = atob(ciphertext.ciphertext);
    const tampered = {
      ...ciphertext,
      ciphertext: btoa(
        String.fromCharCode(raw.charCodeAt(0) ^ 1) + raw.slice(1),
      ),
    };
    await expect(decryptJson(created.key, tampered)).rejects.toThrow();
  });
  it("bản sao lưu chỉ chứa ciphertext và khôi phục đúng dữ liệu", async () => {
    const snapshot = {
      format: 1,
      items: [{ title: "Một ghi chú" }],
      vaultEntries: [{ ciphertext: "opaque" }],
    };
    const backup = await encryptBackup("backup passphrase 123", snapshot);
    expect(JSON.stringify(backup)).not.toContain("Một ghi chú");
    expect(await decryptBackup("backup passphrase 123", backup)).toEqual(
      snapshot,
    );
    await expect(decryptBackup("wrong", backup)).rejects.toThrow();
  });
});
const createVaultKey = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
