import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySession } from "@/lib/auth/token";

describe("password", () => {
  it("hash bisa diverifikasi, password salah ditolak", () => {
    const h = hashPassword("rahasia-banget");
    expect(h).toMatch(/^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    expect(h).not.toContain("$"); // aman dari ekspansi variabel .env
    expect(verifyPassword("rahasia-banget", h)).toBe(true);
    expect(verifyPassword("salah", h)).toBe(false);
    expect(verifyPassword("rahasia-banget", undefined)).toBe(false);
    expect(verifyPassword("rahasia-banget", "sampah")).toBe(false);
  });
});

describe("token sesi", () => {
  it("valid dengan secret yang sama, ditolak kalau diubah/kedaluwarsa/secret beda", async () => {
    const t = await signSession("s3cret");
    expect(await verifySession("s3cret", t)).toBe(true);
    expect(await verifySession("lain", t)).toBe(false);
    expect(await verifySession("s3cret", t.slice(0, -2) + "xx")).toBe(false);
    expect(await verifySession("s3cret", undefined)).toBe(false);
    expect(await verifySession(undefined, t)).toBe(false);
    expect(await verifySession("s3cret", t, Date.now() + 31 * 24 * 3600 * 1000)).toBe(false);
  });
});
