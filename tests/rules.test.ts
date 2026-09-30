import { describe, expect, it } from "vitest";
import { planAllocation, type Alloc } from "@/lib/allocation";
import { jatahHarian, rp, rpShort } from "@/lib/money";
import { addDays, diffDays, fmtRentang, fromWib, sundayOnOrBefore, wibDate, wibHM, weekdayOf } from "@/lib/time";
import { isOwner, normalizePhone, ownerNumbers } from "@/lib/whitelist";

describe("jatahHarian", () => {
  it("Rp61.000 untuk 6 hari = Rp10.100 (dibulatkan ke bawah ke ratusan)", () => {
    expect(jatahHarian(61000, 6)).toBe(10100);
  });
  it("tidak pernah negatif atau membagi nol", () => {
    expect(jatahHarian(-5000, 3)).toBe(0);
    expect(jatahHarian(50000, 0)).toBe(0);
  });
  it("hari terakhir: seluruh sisa", () => {
    expect(jatahHarian(12345, 1)).toBe(12300);
  });
});

describe("format Rupiah", () => {
  it("rp", () => {
    expect(rp(12500)).toBe("Rp12.500");
    expect(rp(0)).toBe("Rp0");
    expect(rp(1250000)).toBe("Rp1.250.000");
    expect(rp(-5000)).toBe("-Rp5.000");
  });
  it("rpShort", () => {
    expect(rpShort(25000)).toBe("25rb");
    expect(rpShort(1500000)).toBe("1,5jt");
  });
});

const PLAN_11_OKT: Alloc = { makan: 85000, data: 30000, paylater: 27000, kado: 125000, darurat: 33000 };

describe("planAllocation", () => {
  it("Rp300.000 = sesuai rencana", () => {
    const r = planAllocation({ income: 300000, plan: PLAN_11_OKT });
    expect(r.alloc).toEqual(PLAN_11_OKT);
    expect(r.potongan).toEqual([]);
  });

  it("Rp250.000: Darurat dipotong duluan, Makan & Data utuh", () => {
    const r = planAllocation({ income: 250000, plan: PLAN_11_OKT });
    expect(r.alloc.makan).toBe(85000);
    expect(r.alloc.data).toBe(30000);
    expect(r.alloc.darurat).toBe(0);
    // kurang 50rb: darurat 33rb habis, sisa 17rb dipotong dari kado
    expect(r.alloc.kado).toBe(108000);
    expect(r.kadoBerkurang).toBe(17000);
    expect(Object.values(r.alloc).reduce((a, b) => a + b, 0)).toBe(250000);
  });

  it("urutan potong: Darurat → Kado → Paylater (paylater dilewati kalau tagihan <= 14 hari)", () => {
    const dekat = planAllocation({ income: 100000, plan: PLAN_11_OKT, hariKeTagihan: 10 });
    expect(dekat.alloc.paylater).toBe(27000);
    expect(dekat.kurangTersisa).toBeGreaterThan(0);
    const jauh = planAllocation({ income: 100000, plan: PLAN_11_OKT, hariKeTagihan: 20 });
    expect(jauh.alloc.paylater).toBeLessThan(27000);
  });

  it("Makan dan Data tidak pernah dipotong otomatis", () => {
    const r = planAllocation({ income: 50000, plan: PLAN_11_OKT, hariKeTagihan: null });
    expect(r.alloc.makan).toBe(85000);
    expect(r.alloc.data).toBe(30000);
    expect(r.kurangTersisa).toBe(65000);
  });

  it("uang lebih: 50% kado, 50% darurat", () => {
    const r = planAllocation({ income: 340000, plan: PLAN_11_OKT });
    expect(r.lebih).toBe(40000);
    expect(r.alloc.kado).toBe(145000);
    expect(r.alloc.darurat).toBe(53000);
  });

  it("uang lebih setelah kado selesai: semua ke darurat", () => {
    const plan: Alloc = { makan: 85000, data: 30000, paylater: 20000, kado: 0, darurat: 165000 };
    const r = planAllocation({ income: 320000, plan });
    expect(r.alloc.kado).toBe(0);
    expect(r.alloc.darurat).toBe(185000);
  });
});

describe("waktu WIB", () => {
  it("23.30 WIB Sabtu masih Sabtu, 17.00 UTC = 00.00 WIB hari berikutnya", () => {
    expect(wibDate(new Date("2026-10-10T16:30:00Z"))).toBe("2026-10-10");
    expect(wibDate(new Date("2026-10-10T17:00:00Z"))).toBe("2026-10-11");
    expect(wibHM(new Date("2026-10-10T17:00:00Z"))).toEqual({ jam: 0, menit: 0 });
  });
  it("4 Okt 2026 adalah Minggu", () => {
    expect(weekdayOf("2026-10-04")).toBe(0);
    expect(sundayOnOrBefore("2026-10-04")).toBe("2026-10-04");
    expect(sundayOnOrBefore("2026-10-07")).toBe("2026-10-04");
    expect(sundayOnOrBefore("2026-10-10")).toBe("2026-10-04");
  });
  it("hitung hari", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(diffDays("2026-10-04", "2026-11-20")).toBe(47);
    expect(fmtRentang("2026-10-11", "2026-10-17")).toBe("11–17 Okt");
    expect(fmtRentang("2026-10-25", "2026-10-31")).toBe("25–31 Okt");
    expect(fmtRentang("2026-10-28", "2026-11-03")).toBe("28 Okt–3 Nov");
  });
  it("fromWib", () => {
    expect(fromWib("2026-10-05", 9, 0).toISOString()).toBe("2026-10-05T02:00:00.000Z");
  });
});

describe("whitelist nomor", () => {
  it("normalisasi ke format internasional", () => {
    expect(normalizePhone("085163544535")).toBe("6285163544535");
    expect(normalizePhone("0851-6354-4535")).toBe("6285163544535");
    expect(normalizePhone("+62 851 6354 4535")).toBe("6285163544535");
    expect(normalizePhone("6285163544535@s.whatsapp.net")).toBe("6285163544535");
    expect(normalizePhone("6285163544535:12@s.whatsapp.net")).toBe("6285163544535");
    expect(normalizePhone("08971688893")).toBe("628971688893");
  });
  it("hanya 2 nomor terdaftar yang lolos", () => {
    const env = { OWNER_WA_NUMBERS: "6285163544535,628971688893" } as unknown as NodeJS.ProcessEnv;
    expect(ownerNumbers(env)).toEqual(["6285163544535", "628971688893"]);
    expect(isOwner("085163544535", env)).toBe(true);
    expect(isOwner("628971688893@s.whatsapp.net", env)).toBe(true);
    expect(isOwner("6281234567890", env)).toBe(false);
    expect(isOwner("", env)).toBe(false);
  });
});
