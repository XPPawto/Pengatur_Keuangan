import type { Db } from "../db";
import { wibDate } from "../time";
import { sinkronkanIndeks, token } from "./ingatan";
import { daftarMemori, pemakaianMemori, RUANG_PEMILIK, type JenisMemori, type PemakaianMemori } from "./memori";
import { statusRefleksi } from "./refleksi";

/**
 * Data untuk halaman Memori: semua memori pemilik sebagai "bintang", ditambah topik obrolan dan kata penghubung,
 * beserta sisi-sisi yang menghubungkannya. Semuanya dihitung dari data yang sudah ada (tanpa AI).
 * Isi obrolan tidak ikut: hanya kata kunci yang sering muncul.
 */

export type TipeNode = "profil" | "catatan" | "topik" | "kata";

export interface NodePeta {
  id: string;
  tipe: TipeNode;
  label: string;
  /** isi lengkap (hanya untuk memori) */
  teks?: string;
  memoriId?: number;
  sumber?: string;
  dibuat?: string;
  diperbarui?: string;
  /** 0..1: seberapa "terang" (kebaruan untuk memori, frekuensi untuk topik) */
  bobot: number;
  /** jumlah pesan (topik) / jumlah memori (kata) yang memuat kata ini */
  jumlah?: number;
}

export interface SisiPeta {
  a: string;
  b: string;
  /** 0..1 */
  w: number;
  /** "kata" = memori memuat kata itu; "mirip" = dua memori berbagi banyak kata */
  jenis: "kata" | "mirip";
}

export interface KejadianMemori {
  id: string;
  waktu: string;
  teks: string;
  /** dibuat AI / oleh pengguna / pembatalan */
  asal: "asisten" | "pengguna" | "batal";
  /** id log aktivitas yang bisa dibatalkan; null kalau tidak bisa / sudah dibatalkan */
  logId: number | null;
  dibatalkan: boolean;
}

export interface PetaMemori {
  sekarang: string;
  node: NodePeta[];
  sisi: SisiPeta[];
  pemakaian: PemakaianMemori[];
  /** pesan obrolan pemilik yang sudah terindeks */
  pesanTerindeks: number;
  belajar: { aktif: boolean; giliranBaru: number; tiap: number };
  hariIni: { ditambah: number; diperbarui: number; dariAI: number };
  kejadian: KejadianMemori[];
}

const MAKS_TOPIK = 14;
const MAKS_KATA = 18;
const MAKS_TETANGGA = 3;
const bukanGrup = { NOT: { kanal: { startsWith: "grup:" } } };

const hariLalu = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 86_400_000);

export async function bangunPetaMemori(db: Db, now: Date, tiap = 3): Promise<PetaMemori> {
  try {
    await sinkronkanIndeks(db);
  } catch {
    /* indeks gagal: peta tetap tampil tanpa topik obrolan */
  }
  const [entri, pemakaian, st, pesanTerindeks, idObrolan, logs] = await Promise.all([
    daftarMemori(db, RUANG_PEMILIK),
    pemakaianMemori(db, RUANG_PEMILIK),
    statusRefleksi(db, now),
    db.aiChat.count({ where: bukanGrup }),
    // topik berasal dari apa yang ditanyakan pemilik, bukan dari kata-kata di jawaban asisten
    db.aiChat.findMany({ where: { ...bukanGrup, peran: "user" }, orderBy: { id: "desc" }, take: 800, select: { id: true } }),
    db.activityLog.findMany({ where: { aksi: "memori" }, orderBy: [{ waktu: "desc" }, { id: "desc" }], take: 20 }),
  ]);

  const kataEntri = new Map(entri.map((e) => [e.id, new Set(token(e.isi))]));

  // topik obrolan: kata yang paling sering muncul di obrolan pemilik (grup tidak ikut)
  const hitung = idObrolan.length
    ? await db.aiIngatanKata.groupBy({ by: ["kata"], where: { chatId: { in: idObrolan.map((r) => r.id) } }, _count: { _all: true }, orderBy: { _count: { kata: "desc" } }, take: 80 })
    : [];
  const dipakaiMemori = new Set([...kataEntri.values()].flatMap((s) => [...s]));
  const layak = hitung.filter((h) => h._count._all >= 2 && h.kata.length >= 4);
  const topik = [...layak.slice(0, MAKS_TOPIK), ...layak.slice(MAKS_TOPIK).filter((h) => dipakaiMemori.has(h.kata)).slice(0, 8)];
  const maksHitung = Math.max(1, ...topik.map((t) => t._count._all));
  const kataTopik = new Set(topik.map((t) => t.kata));

  // kata penghubung: dimuat minimal dua memori dan bukan topik
  const perKata = new Map<string, number>();
  for (const s of kataEntri.values()) for (const k of s) if (k.length >= 4 && !kataTopik.has(k)) perKata.set(k, (perKata.get(k) ?? 0) + 1);
  const kata = [...perKata.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, MAKS_KATA);
  const kataSet = new Set(kata.map(([k]) => k));

  const node: NodePeta[] = [
    ...entri.map<NodePeta>((e) => ({
      id: `m${e.id}`,
      tipe: e.jenis,
      label: e.isi.length > 36 ? `${e.isi.slice(0, 35).trimEnd()}…` : e.isi,
      teks: e.isi,
      memoriId: e.id,
      sumber: e.sumber,
      dibuat: e.dibuatPada.toISOString(),
      diperbarui: e.diperbarui.toISOString(),
      bobot: 0.4 + 0.6 * Math.exp(-hariLalu(e.diperbarui, now) / 60),
    })),
    ...topik.map<NodePeta>((t) => ({ id: `t:${t.kata}`, tipe: "topik", label: t.kata, bobot: 0.3 + 0.7 * (t._count._all / maksHitung), jumlah: t._count._all })),
    ...kata.map<NodePeta>(([k, n]) => ({ id: `k:${k}`, tipe: "kata", label: k, bobot: 0.4, jumlah: n })),
  ];

  const sisi: SisiPeta[] = [];
  for (const e of entri) {
    for (const k of kataEntri.get(e.id)!) {
      if (kataTopik.has(k)) sisi.push({ a: `m${e.id}`, b: `t:${k}`, w: 0.6, jenis: "kata" });
      else if (kataSet.has(k)) sisi.push({ a: `m${e.id}`, b: `k:${k}`, w: 0.5, jenis: "kata" });
    }
  }
  // memori yang mirip: berbagi minimal dua kata atau kemiripan tinggi; paling banyak tiga tetangga tiap memori
  const calon: { a: number; b: number; w: number }[] = [];
  for (let i = 0; i < entri.length; i++) {
    for (let j = i + 1; j < entri.length; j++) {
      const A = kataEntri.get(entri[i].id)!;
      const B = kataEntri.get(entri[j].id)!;
      let sama = 0;
      for (const k of A) if (B.has(k)) sama++;
      const jac = sama / Math.max(1, A.size + B.size - sama);
      if (sama >= 2 || jac >= 0.25) calon.push({ a: entri[i].id, b: entri[j].id, w: Math.min(1, jac * 1.6) });
    }
  }
  const jumlahTetangga = new Map<number, number>();
  for (const c of calon.sort((x, y) => y.w - x.w)) {
    if ((jumlahTetangga.get(c.a) ?? 0) >= MAKS_TETANGGA || (jumlahTetangga.get(c.b) ?? 0) >= MAKS_TETANGGA) continue;
    jumlahTetangga.set(c.a, (jumlahTetangga.get(c.a) ?? 0) + 1);
    jumlahTetangga.set(c.b, (jumlahTetangga.get(c.b) ?? 0) + 1);
    sisi.push({ a: `m${c.a}`, b: `m${c.b}`, w: c.w, jenis: "mirip" });
  }

  const hari = wibDate(now);
  const hariIni = {
    ditambah: entri.filter((e) => wibDate(e.dibuatPada) === hari).length,
    diperbarui: entri.filter((e) => wibDate(e.diperbarui) === hari && e.diperbarui.getTime() - e.dibuatPada.getTime() > 1000).length,
    dariAI: entri.filter((e) => e.sumber === "asisten" && wibDate(e.dibuatPada) === hari).length,
  };

  // linimasa: perubahan oleh AI (bisa dibatalkan) + hal yang ditambahkan pengguna sendiri
  const kejadian: KejadianMemori[] = [
    ...logs.map<KejadianMemori>((l) => ({ id: `l${l.id}`, waktu: l.waktu.toISOString(), teks: l.ringkasan.replace(/^Memori: /, ""), asal: "asisten", logId: l.undo && !l.dibatalkanPada ? l.id : null, dibatalkan: !!l.dibatalkanPada })),
    ...entri.filter((e) => e.sumber !== "asisten").map<KejadianMemori>((e) => ({ id: `e${e.id}`, waktu: e.dibuatPada.toISOString(), teks: `ingat "${e.isi.length > 70 ? `${e.isi.slice(0, 69).trimEnd()}…` : e.isi}"`, asal: "pengguna", logId: null, dibatalkan: false })),
  ]
    .sort((a, b) => b.waktu.localeCompare(a.waktu))
    .slice(0, 16);

  return { sekarang: now.toISOString(), node, sisi, pemakaian, pesanTerindeks, belajar: { aktif: st.belajar, giliranBaru: st.giliranBaru, tiap }, hariIni, kejadian };
}

export type { JenisMemori };
