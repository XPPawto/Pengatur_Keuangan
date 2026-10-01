import type { Db } from "../db";
import { fromWib, wibDate } from "../time";
import { getSetting, getSettingNumber, setSetting } from "../services/settings";
import { ownerNumbers } from "../whitelist";
import type { IncomingWaMessage } from "../whatsapp/gateway";
import { getTokenAI, kunciCadangan, LABEL_PENYEDIA, panggilAI, type Penyedia } from "./panggil";

/**
 * AI grup WhatsApp: bot yang sama jadi asisten AI umum untuk SATU grup.
 *
 * - Terpisah total dari DompetKos: pesan grup tidak pernah masuk ke `handleMessage`, prompt tidak berisi data
 *   keuangan, dan AI tidak punya tool / aksi apa pun.
 * - Hanya grup yang dipilih pemilik (`grup_ai_jid`) yang dilayani; grup lain diabaikan tanpa membalas atau menyimpan apa pun.
 * - Penyedia (Claude, Gemini, OpenRouter) dipakai bergiliran (round robin) di antara yang sudah tersambung; kalau
 *   satu gagal, langsung dicoba penyedia berikutnya dalam giliran yang sama.
 * - Jatah sendiri (per hari & per orang per menit) supaya ramainya grup tidak menghabiskan kuota AI pemilik.
 */

const KODE_PERINTAH = /^!aigrup\b\s*(.*)$/i;
/** Awalan untuk memanggil AI di grup: `/ai apa itu fotosintesis?` */
const AWALAN_AI = /^\/ai\b[\s:,]*([\s\S]*)$/i;
const MODE_GRUP = ["perintah", "pertanyaan", "semua"] as const;
const RODA: readonly Penyedia[] = ["claude", "gemini", "openrouter"];

export const SYSTEM_GRUP = [
  "Kamu asisten AI serbaguna di sebuah grup WhatsApp. Jawab pertanyaan apa pun dari anggota grup: pengetahuan umum, teknologi, belajar, tulisan, terjemahan, saran, hitung-hitungan, ide, dan sebagainya.",
  "",
  "Aturan:",
  "- Pakai bahasa yang sama dengan penanya (bawaan: Bahasa Indonesia yang santai tapi sopan).",
  "- Singkat dan jelas: sekitar 6 kalimat kecuali diminta rinci. Format WhatsApp saja: *tebal*, daftar dengan \"• \". Jangan pakai tabel, heading markdown, atau blok kode panjang.",
  "- Kamu tidak punya akses ke internet, data pribadi siapa pun, atau riwayat chat selain potongan percakapan yang diberikan. Kalau tidak tahu atau informasinya mungkin sudah usang, katakan terus terang; jangan mengarang.",
  "- Jangan membahas aplikasi keuangan, saldo, atau data pribadi pengguna mana pun.",
  "- Tolak dengan sopan permintaan yang berbahaya, ilegal, atau melecehkan. Jangan membagikan data pribadi orang.",
  "- Anggota grup bisa banyak; nama penanya ada di awal pesan. Jawab untuk penanya itu.",
].join("\n");

// ---------------------------------------------------------------- keadaan di memori (satu proses bot)

let putaran: number | null = null;
const jejakOrang = new Map<string, number[]>();
const pemberitahuan = new Map<string, number>();

/** Kosongkan keadaan di memori (dipakai tes). */
export function resetKeadaanGrup() {
  putaran = null;
  jejakOrang.clear();
  pemberitahuan.clear();
}

/** true kalau pemberitahuan jenis ini boleh dikirim sekarang (maks sekali per `jedaMs`), lalu dicatat. */
function bolehBeritahu(kunci: string, now: Date, jedaMs: number) {
  const t = pemberitahuan.get(kunci);
  if (t !== undefined && now.getTime() - t < jedaMs) return false;
  pemberitahuan.set(kunci, now.getTime());
  if (pemberitahuan.size > 500) pemberitahuan.delete(pemberitahuan.keys().next().value!);
  return true;
}

// ---------------------------------------------------------------- deteksi pertanyaan & pembersihan

const KATA_TANYA =
  /^(apa|apakah|siapa|siapakah|kapan|kapankah|dimana|di mana|kemana|ke mana|darimana|dari mana|kenapa|mengapa|bagaimana|gimana|gmn|berapa|mana|bisa|bisakah|boleh|bolehkah|tolong|bantu|bantuin|jelaskan|jelasin|sebutkan|carikan|cariin|buatkan|buatin|terjemahkan|translate|artinya|rekomendasi|saran|what|how|why|who|when|where|which|can|could|should|is|are|do|does|please|explain|tell)\b/i;

/** Pesan ini berbentuk pertanyaan / permintaan yang pantas dijawab asisten? */
export function adalahPertanyaan(teks: string): boolean {
  const t = teks.trim();
  if (t.length < 4) return false;
  return t.includes("?") || KATA_TANYA.test(t);
}

/** Rapikan jawaban model untuk WhatsApp: **tebal** → *tebal*, buang heading markdown, batasi panjang. */
export function bersihkanBalasan(teks: string, maks = 3000): string {
  const t = teks
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > maks ? `${t.slice(0, maks - 1).trimEnd()}…` : t;
}

// ---------------------------------------------------------------- giliran penyedia (round robin)

/** Penyedia yang sudah tersambung (punya token / key / login), urut tetap: Claude, Gemini, OpenRouter. */
export async function penyediaTersedia(db: Db): Promise<Penyedia[]> {
  const out: Penyedia[] = [];
  const t = await getTokenAI(db);
  if (t.token || t.sumber === "folder") out.push("claude");
  for (const p of ["gemini", "openrouter"] as const) {
    const k = await kunciCadangan(db, p);
    if (k.kunci || k.sumber === "login") out.push(p);
  }
  return out;
}

/** Urutan percobaan untuk giliran ke-`n`: mulai dari penyedia ke-(n mod jumlah), lalu berikutnya sebagai cadangan. */
export function urutanGiliran(tersedia: readonly Penyedia[], n: number): Penyedia[] {
  if (!tersedia.length) return [];
  const mulai = ((n % tersedia.length) + tersedia.length) % tersedia.length;
  return [...tersedia.slice(mulai), ...tersedia.slice(0, mulai)];
}

/** Nomor giliran berikutnya (bertambah satu per permintaan, tahan restart bot). */
async function giliranBerikut(db: Db): Promise<number> {
  if (putaran === null) putaran = Number(await getSetting(db, "grup_ai_putaran")) || 0;
  const v = putaran;
  putaran = v + 1; // naik sebelum await supaya dua pesan bersamaan tidak mendapat giliran yang sama
  await setSetting(db, "grup_ai_putaran", String(putaran % 1_000_000));
  return v;
}

// ---------------------------------------------------------------- perintah pemilik

async function pemakaianGrupHariIni(db: Db, now: Date): Promise<number> {
  return db.aiCall.count({ where: { waktu: { gte: fromWib(wibDate(now)) }, fitur: "chat_grup", utama: true } });
}

async function perintahGrup(db: Db, jidIni: string, jidAktif: string, arg: string, now: Date): Promise<string | null> {
  const [kata, ...sisa] = arg.toLowerCase().split(/\s+/);
  const aktifDiIni = !!jidAktif && jidIni === jidAktif;
  if (kata === "aktif" || kata === "on") {
    await setSetting(db, "grup_ai_jid", jidIni);
    await setSetting(db, "grup_ai_aktif", "1");
    const tersedia = await penyediaTersedia(db);
    const mode = await getSetting(db, "grup_ai_mode");
    return [
      "*AI grup aktif* di grup ini 🤖",
      mode === "semua"
        ? "Aku jawab setiap pesan teks."
        : mode === "pertanyaan"
          ? "Aku jawab pesan berawalan */ai*, pesan berbentuk pertanyaan, atau kalau aku di-mention / balas pesanku."
          : "Tanya aku dengan awalan */ai*, contoh: `/ai apa itu fotosintesis?` (atau balas pesanku buat lanjut ngobrol).",
      tersedia.length ? `Penyedia bergiliran: ${tersedia.map((p) => LABEL_PENYEDIA[p]).join(" → ")}.` : "⚠️ Belum ada penyedia AI yang tersambung (atur di website → Koneksi).",
      "Perintah pemilik: `!aigrup status` · `!aigrup mati` · `!aigrup mode perintah|pertanyaan|semua` · `!aigrup reset`",
    ].join("\n");
  }
  if (!aktifDiIni) return null; // perintah lain hanya berlaku di grup yang sedang dipilih
  if (kata === "mati" || kata === "off") {
    await setSetting(db, "grup_ai_aktif", "0");
    return "AI grup dimatikan. Ketik `!aigrup aktif` untuk menyalakan lagi.";
  }
  if (kata === "mode") {
    const m = sisa[0];
    if (!(MODE_GRUP as readonly string[]).includes(m ?? "")) return "Pakai: `!aigrup mode perintah` (hanya /ai), `pertanyaan`, atau `semua`.";
    await setSetting(db, "grup_ai_mode", m!);
    return m === "semua" ? "Oke, sekarang aku jawab setiap pesan teks di grup." : m === "pertanyaan" ? "Oke, aku jawab /ai, pesan berbentuk pertanyaan, atau kalau di-mention." : "Oke, aku hanya jawab pesan berawalan /ai (atau kalau di-mention / pesanku dibalas).";
  }
  if (kata === "reset") {
    await db.aiChat.deleteMany({ where: { kanal: `grup:${jidIni}` } });
    return "Ingatan percakapan grup dihapus.";
  }
  if (kata === "status" || !kata) {
    const [aktif, mode, batas, tersedia, pakai] = await Promise.all([
      getSetting(db, "grup_ai_aktif"),
      getSetting(db, "grup_ai_mode"),
      getSettingNumber(db, "grup_ai_batas_harian"),
      penyediaTersedia(db),
      pemakaianGrupHariIni(db, now),
    ]);
    return [
      `*AI grup:* ${aktif === "1" ? "aktif" : "mati"} · mode ${mode}`,
      `Pemakaian hari ini: ${pakai} / ${batas}`,
      `Penyedia bergiliran: ${tersedia.length ? tersedia.map((p) => LABEL_PENYEDIA[p]).join(" → ") : "belum ada"}`,
    ].join("\n");
  }
  return "Perintah: `!aigrup aktif` · `mati` · `status` · `mode perintah|pertanyaan|semua` · `reset`";
}

// ---------------------------------------------------------------- pesan grup

const bersihNama = (n: string | undefined, nomor: string) => (n ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 30) || `+${nomor.slice(-4)}`;

/**
 * Proses satu pesan grup. Mengembalikan teks balasan untuk dikirim ke grup, atau null (diabaikan).
 * `opsi.mengetik` dipanggil sekali sebelum menunggu AI.
 */
export async function prosesPesanGrup(db: Db, m: IncomingWaMessage, now: Date, opsi: { mengetik?: () => void } = {}): Promise<string | null> {
  const g = m.grup;
  if (!g) return null;
  const teks = m.text.trim().slice(0, 1500);
  if (!teks) return null;

  const jidAktif = await getSetting(db, "grup_ai_jid");
  const perintah = KODE_PERINTAH.exec(teks);
  if (perintah) {
    // hanya pemilik; yang lain diabaikan tanpa balasan supaya perintah tidak "bocor"
    return ownerNumbers().includes(m.nomor) ? perintahGrup(db, g.jid, jidAktif, perintah[1].trim(), now) : null;
  }

  if (!jidAktif || g.jid !== jidAktif) return null; // grup lain: diam, tidak menyimpan apa pun
  if ((await getSetting(db, "grup_ai_aktif")) !== "1") return null;

  // ---- pemicu: /ai selalu memanggil; mode menentukan apakah pesan lain (pertanyaan / semua) juga dijawab
  const mode = await getSetting(db, "grup_ai_mode");
  const awalan = AWALAN_AI.exec(teks);
  const isi = awalan ? awalan[1].trim() : teks;
  const pantas = !!awalan || g.disapa || (mode === "semua" ? teks.length >= 2 : mode === "pertanyaan" && adalahPertanyaan(teks));
  if (!pantas) return null;
  if (!isi) return bolehBeritahu(`bantuan:${m.nomor}`, now, 60_000) ? "Tulis pertanyaannya setelah */ai*, contoh: `/ai apa itu fotosintesis?`" : null;

  // ---- batas: per orang per menit, lalu per hari untuk seluruh grup
  const nama = bersihNama(g.nama, m.nomor);
  const maksMenit = Math.max(1, (await getSettingNumber(db, "grup_ai_per_orang_menit")) || 3);
  const jejak = (jejakOrang.get(m.nomor) ?? []).filter((t) => now.getTime() - t < 60_000);
  if (jejak.length >= maksMenit) {
    jejakOrang.set(m.nomor, jejak);
    return bolehBeritahu(`pelan:${m.nomor}`, now, 5 * 60_000) ? `Pelan-pelan ya ${nama}, maks ${maksMenit} pertanyaan per menit 😊` : null;
  }
  jejak.push(now.getTime());
  jejakOrang.set(m.nomor, jejak);
  if (jejakOrang.size > 500) jejakOrang.delete(jejakOrang.keys().next().value!);

  const batas = (await getSettingNumber(db, "grup_ai_batas_harian")) || 150;
  if ((await pemakaianGrupHariIni(db, now)) >= batas) {
    return bolehBeritahu(`habis:${wibDate(now)}`, now, 24 * 3600_000) ? `Jatah AI grup hari ini (${batas} pertanyaan) sudah habis. Lanjut besok ya 🙏` : null;
  }

  const tersedia = await penyediaTersedia(db);
  if (!tersedia.length) return bolehBeritahu("kosong", now, 3600_000) ? "AI grup belum bisa dipakai: belum ada penyedia AI yang tersambung." : null;

  // ---- percakapan terakhir di grup (ingatan pendek) → prompt tanpa data keuangan
  const kanal = `grup:${g.jid}`;
  const lalu = (await db.aiChat.findMany({ where: { kanal, waktu: { gte: new Date(now.getTime() - 3 * 3600_000) } }, orderBy: { id: "desc" }, take: 10 })).reverse();
  const prompt = [
    lalu.length ? ["# Percakapan terakhir di grup", ...lalu.map((r) => r.isi), ""].join("\n") : "",
    `# Pesan baru dari ${nama}`,
    isi,
  ].join("\n");

  opsi.mengetik?.();
  const urutan = urutanGiliran(tersedia, await giliranBerikut(db));
  let terakhir = "";
  for (const p of urutan) {
    const h = await panggilAI(db, { fitur: "chat_grup", system: SYSTEM_GRUP, prompt, now, timeoutMs: 60_000, penyedia: p });
    if (!h.ok) {
      terakhir = h.pesan;
      continue; // penyedia ini gagal: langsung giliran berikutnya
    }
    const jawaban = bersihkanBalasan(h.teks);
    if (!jawaban) continue;
    await db.aiChat.createMany({
      data: [
        { kanal, peran: "user", isi: `${nama}: ${isi}`, waktu: now },
        { kanal, peran: "asisten", isi: `Asisten: ${jawaban}`.slice(0, 1500), waktu: new Date(now.getTime() + 1) },
      ],
    });
    const tanda = (await getSetting(db, "grup_ai_tanda")) === "1" ? `\n\n_via ${LABEL_PENYEDIA[h.penyedia ?? p]}${h.model ? ` · ${h.model}` : ""}_` : "";
    return `${jawaban}${tanda}`;
  }
  void terakhir; // alasan teknis tidak ditampilkan ke grup (bisa berisi detail akun); tercatat di log panggilan AI
  return bolehBeritahu("gagal", now, 10 * 60_000) ? "Maaf, layanan AI lagi sibuk atau bermasalah. Coba lagi sebentar ya 🙏" : null;
}
