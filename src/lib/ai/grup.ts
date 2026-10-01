import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { jenisGambar, MAKS_GAMBAR } from "../keamanan/gambar";
import { wibDate } from "../time";
import { getSetting, getSettingNumber, setSetting } from "../services/settings";
import { ownerNumbers } from "../whitelist";
import type { IncomingWaMessage } from "../whatsapp/gateway";
import { AI_WORK_DIR } from "./claude";
import { batasClaude, CADANGAN, getTokenAI, kunciCadangan, LABEL_PENYEDIA, panggilAI, type Penyedia } from "./panggil";

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
const RODA: readonly Penyedia[] = ["claude", "gemini", "openrouter", "groq"];

export const SYSTEM_GRUP = [
  "Kamu *Fable 5*, asisten AI di sebuah grup WhatsApp. Anggota grup memanggilmu dengan awalan /ai. Jadilah asisten terbaik yang pernah mereka pakai: cerdas, tepat, hangat, dan terasa premium, seperti konsultan ahli yang ramah.",
  "",
  "Yang bisa kamu lakukan: menjawab pertanyaan apa pun, menjelaskan konsep dengan contoh, menerjemahkan, meringkas atau memperbaiki teks (termasuk pesan yang dibalas), menulis (caption, pesan, email, puisi), brainstorming ide, hitung-hitungan, bantu kode, kasih saran praktis, dan membaca gambar/foto yang dikirim.",
  "",
  "Kualitas jawaban:",
  "- Langsung ke inti. Jangan membuka dengan sapaan basa-basi atau mengulang pertanyaan, dan jangan menutup dengan \"ada yang bisa kubantu lagi?\". Satu saran lanjutan atau pertanyaan pemantik di akhir hanya kalau benar-benar berguna.",
  "- Substantif dan spesifik: beri alasan di balik jawaban, contoh konkret, angka, atau analogi yang pas. Hindari kalimat umum yang bisa ditempel di jawaban apa pun.",
  "- Sesuaikan panjang dengan soalnya: obrolan ringan 1–3 kalimat; penjelasan, kuliah, atau koding terstruktur (judul tebal singkat, poin, langkah) sekitar 80–220 kata kecuali diminta rinci.",
  "- Kalau ada beberapa kemungkinan, sebutkan mana yang paling mungkin dan kenapa. Kalau soalnya ambigu, tanya satu pertanyaan singkat. Kalau premis penanya keliru, koreksi dengan sopan.",
  "",
  "Gaya:",
  "- Hangat dan percaya diri. Emoji secukupnya (paling banyak satu atau dua).",
  "- Pakai bahasa yang sama dengan penanya (bawaan: Bahasa Indonesia santai tapi sopan; bisa juga Inggris, Jawa, dll.).",
  "- Format WhatsApp saja: *tebal*, daftar dengan \"• \". Jangan pakai tabel, heading markdown, atau blok kode panjang.",
  "- Anggota grup bisa banyak; nama penanya ada di awal pesan. Jawab untuk penanya itu.",
  "",
  "Identitas: namamu *Fable 5*, asisten AI grup ini. Kalau ada yang bertanya kamu siapa / AI apa / model apa / kenapa kamu pintar, jawab singkat (1–2 kalimat) dan percaya diri bahwa kamu Fable 5, asisten AI grup ini, lalu tawarkan apa yang bisa kamu bantu. Jangan pernah mengaku manusia. JANGAN menceritakan cara kerja internalmu (penyedia, giliran, penggabungan, draf, cara pelatihan). Kalau ditanya langsung soal teknologi atau perusahaan di balik dirimu, katakan ringkas bahwa kamu tidak punya detail teknis tentang itu; jangan menyebut nama perusahaan atau model dan jangan mengarang.",
  "",
  "Kejujuran:",
  "- Kamu TIDAK bisa membuka internet atau info real-time (berita, cuaca, skor, harga, kurs) dan TIDAK bisa membuat gambar. Sebutkan batas ini HANYA kalau permintaannya memang membutuhkan itu; jangan menyelipkannya di jawaban lain. Lalu bantu sebisanya (mis. jelaskan caranya, atau jawab dari pengetahuan umum sambil bilang bisa sudah usang).",
  "- Jangan mengarang fakta, angka, kutipan, atau tautan. Kalau tidak yakin, katakan.",
  "- Kamu tidak punya akses ke data pribadi siapa pun atau riwayat chat selain potongan percakapan yang diberikan.",
  "",
  "Aturan:",
  "- Jangan membahas aplikasi keuangan, saldo, atau data pribadi pengguna mana pun.",
  "- Tolak dengan sopan permintaan yang berbahaya, ilegal, atau melecehkan. Jangan membagikan data pribadi orang.",
  "",
  "Bagian \"Pesan yang dibalas\" (kalau ada) adalah pesan yang sedang dibalas penanya, jadi permintaan seperti \"terjemahkan\" atau \"ringkas\" merujuk ke pesan itu. Bagian \"Gambar\" (kalau ada) berarti ada file gambar yang harus dibuka dan dilihat dulu.",
].join("\n");

/** Nama asisten di grup. */
export const NAMA_ASISTEN = "Fable 5";
export const IDENTITAS = `Aku *${NAMA_ASISTEN}*, asisten AI di grup ini 🤖\nKetik \`/ai bantuan\` buat lihat yang bisa kubantu.`;

/** Pertanyaan identitas sederhana ("ai apa?", "model apa?", "kamu siapa?"): dijawab langsung tanpa memanggil AI. Sengaja ketat supaya pertanyaan sungguhan tidak ikut tertangkap. */
const RE_IDENTITAS = [
  /^(kamu |lu |lo |anda |kau |ini |itu )?(ai|model|bot|asisten|aplikasi)( ini| itu| kamu| lu| mu)? ?(itu )?(apa|siapa)( sih| ya| dong| nih| ini| itu| sebenarnya)?$/,
  /^(kamu|lu|lo|anda|kau) (itu )?(siapa|apa)( sih| ya| dong| nih| sebenarnya)?$/,
  /^siapa (kamu|lu|lo|anda|kau|namamu|nama kamu|nama lu)( sih| ya| dong| nih)?$/,
  /^(nama ?(kamu|mu|lu)) (siapa|apa)( sih| ya| dong)?$/,
  /^(kamu |lu |lo )?(pakai|pake|memakai|menggunakan|berbasis) (ai|model) apa( ini| itu| sih| ya| dong| nih)?$/,
  /^(what|which) (ai|model|bot) (are you|is this)$/,
  /^who are you$/,
];
export function pertanyaanIdentitas(teks: string): boolean {
  const t = teks.toLowerCase().replace(/[?!.,]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= 40 && RE_IDENTITAS.some((r) => r.test(t));
}

/** Tambahan instruksi untuk tahap penggabungan jawaban dari beberapa penyedia. */
export const SYSTEM_EDITOR = [
  "",
  "PERAN SEKARANG: editor jawaban. Di bawah ada beberapa draf jawaban (dari asisten AI berbeda) untuk pesan baru dari penanya. Tugasmu menulis SATU jawaban final terbaik, selevel jawaban asisten AI premium.",
  "- Ambil isi yang paling benar, jelas, dan berguna dari semua draf; gabungkan yang saling melengkapi; buang pengulangan.",
  "- Buang basa-basi, sapaan pembuka, penutup generik, dan peringatan berulang. Pertahankan peringatan (mis. tanpa info real-time) hanya kalau pertanyaannya memang membutuhkannya.",
  "- Kalau draf saling bertentangan soal fakta, pilih yang paling bisa dipertanggungjawabkan; kalau tidak bisa dipastikan, katakan tidak yakin. Jangan menambah fakta, angka, atau tautan baru yang tidak ada di draf.",
  "- Ikuti semua aturan kualitas, gaya, identitas, dan kejujuran di atas (bahasa penanya, padat, format WhatsApp, tidak menceritakan cara kerja internal).",
  "- Jangan menyebut \"draf\", \"jawaban A/B/C\", penyedia, atau bahwa ada beberapa asisten. Tulis langsung jawabannya.",
].join("\n");

const BANTUAN_RE = /^(bantuan|help|menu|fitur|\?)$/i;
export const BANTUAN = [
  "*Aku asisten AI grup ini* 🤖",
  "",
  "• `/ai <pertanyaan>`: tanya apa saja, contoh `/ai kenapa langit biru?`",
  "• *Balas pesan* siapa pun lalu `/ai terjemahkan ke Inggris`, `/ai ringkas`, `/ai jelaskan`, `/ai perbaiki tulisannya`",
  "• *Kirim foto* dengan caption `/ai ini apa?`, atau balas sebuah foto dengan `/ai …`",
  "• *Lanjut ngobrol*: balas jawabanku, atau `/ai` lagi (aku ingat percakapan terakhir)",
  "",
  "Aku bisa: jawab pertanyaan, jelasin, terjemahin, ringkas, nulis, ide, hitung-hitungan, bantu kode, baca foto.",
  "Belum bisa: buka internet / info real-time (berita, cuaca, skor, harga) dan bikin gambar.",
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

/** Kalimat yang membocorkan cara kerja internal (penyedia, giliran, detail model) dibuang, apa pun yang dikatakan model. */
const RE_BOCOR = [/[^.!?\n]*\bbergiliran\b[^.!?\n]*\bpenyedia\b[^.!?\n]*[.!?]*/gi, /[^.!?\n]*\bpenyedia\b[^.!?\n]*\bbergiliran\b[^.!?\n]*[.!?]*/gi, /[^.!?\n]*tanpa detail (?:model )?spesifik[^.!?\n]*[.!?]*/gi];

/** Rapikan jawaban model untuk WhatsApp: **tebal** → *tebal*, buang heading markdown, buang bocoran internal, batasi panjang. */
export function bersihkanBalasan(teks: string, maks = 3000): string {
  const t = RE_BOCOR.reduce((x, re) => x.replace(re, ""), teks)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > maks ? `${t.slice(0, maks - 1).trimEnd()}…` : t;
}

// ---------------------------------------------------------------- tingkat soal → model Claude

export type TingkatSoal = "ringan" | "berat" | "sangat_berat";

const RE_SANGAT_BERAT =
  /\b(buktikan|pembuktian|turunkan rumus|derivasi|tesis|disertasi|riset|penelitian|arsitektur sistem|system design|desain sistem|kompleksitas|big-?o|refactor|analisis mendalam|secara mendalam|langkah demi langkah lengkap|bandingkan secara rinci|teorema|lemma|persamaan diferensial|kalkulus lanjut|multivariabel|machine learning|deep learning|neural network|kriptografi|optimisasi|optimasi algoritma)\b/i;
const RE_BERAT =
  /\b(kode|koding|coding|program|pemrograman|script|skrip|python|javascript|typescript|java|php|golang|kotlin|rust|sql|query|html|css|react|laravel|api|error|bug|debug|fungsi|function|class|algoritma|struktur data|rumus|integral|turunan|limit|matriks|vektor|persamaan|fisika|kimia|biologi|statistik|probabilitas|ekonomi|akuntansi|manajemen|hukum|kuliah|perkuliahan|dosen|tugas|makalah|esai|essay|jurnal|skripsi|praktikum|ujian|uts|uas|soal|analisis|analisa|hitunglah|tentukan|jelaskan secara rinci)\b/i;
const RE_KODE = /```|=>|\bdef \w+\(|\bfunction\s*\w*\(|#include|\bSELECT\b[\s\S]*\bFROM\b|<\/?[a-z][\w-]*[ >]|;\s*$/im;

/**
 * Seberapa berat pertanyaan ini, dari isinya (tanpa memanggil AI): ringan = obrolan & pertanyaan harian;
 * berat = kuliah, koding, hitungan, foto; sangat berat = pembuktian, riset, desain sistem, teks/kode sangat panjang.
 */
export function tingkatSoal(teks: string, o: { gambar?: boolean; kutipan?: string } = {}): TingkatSoal {
  const kutip = (o.kutipan ?? "").slice(0, 3000);
  const panjang = teks.length + kutip.length;
  const adaKode = RE_KODE.test(`${teks}\n${kutip}`);
  if (RE_SANGAT_BERAT.test(teks) || panjang > 1200 || (adaKode && panjang > 600)) return "sangat_berat";
  if (RE_BERAT.test(teks) || adaKode || panjang > 280 || o.gambar) return "berat";
  return "ringan";
}

const MODEL_TINGKAT: Record<TingkatSoal, string> = { ringan: "haiku", berat: "sonnet", sangat_berat: "opus" };

/**
 * Model Claude untuk pesan grup ini. Opus paling boros kuota langganan (dipakai bersama claude.ai), jadi turun ke
 * Sonnet kalau sesi 5 jam ≥ 70% atau mingguan ≥ 85%. undefined = ikut model dari pengaturan Asisten.
 */
export async function modelClaudeGrup(db: Db, tingkat: TingkatSoal, now: Date): Promise<string | undefined> {
  const pilih = await getSetting(db, "grup_ai_model_claude");
  if (pilih === "bawaan") return undefined;
  if (pilih === "haiku" || pilih === "sonnet" || pilih === "opus") return pilih;
  const m = MODEL_TINGKAT[tingkat];
  if (m !== "opus") return m;
  const penuh = (await batasClaude(db, now)).some((j) => (j.kode === "five_hour" ? j.persen >= 70 : j.persen >= 85));
  return penuh ? "sonnet" : m;
}

// ---------------------------------------------------------------- giliran penyedia (round robin)

/** Penyedia yang sudah tersambung (punya token / key / login), urut tetap: Claude, Gemini, OpenRouter. */
export async function penyediaTersedia(db: Db): Promise<Penyedia[]> {
  const out: Penyedia[] = [];
  const t = await getTokenAI(db);
  if (t.token || t.sumber === "folder") out.push("claude");
  for (const p of CADANGAN) {
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

/** Jawaban AI grup hari ini (satu per pertanyaan, walau dijawab beberapa penyedia sekaligus). */
export async function jawabanGrupHariIni(db: Db, now: Date): Promise<number> {
  const [tgl, n] = (await getSetting(db, "grup_ai_hitung")).split(":");
  return tgl === wibDate(now) ? Number(n) || 0 : 0;
}
async function catatJawabanGrup(db: Db, now: Date) {
  await setSetting(db, "grup_ai_hitung", `${wibDate(now)}:${(await jawabanGrupHariIni(db, now)) + 1}`);
}
const pemakaianGrupHariIni = jawabanGrupHariIni;

async function perintahGrup(db: Db, jidIni: string, jidAktif: string, arg: string, now: Date): Promise<string | null> {
  const [kata, ...sisa] = arg.toLowerCase().split(/\s+/);
  const aktifDiIni = !!jidAktif && jidIni === jidAktif;
  if (kata === "aktif" || kata === "on") {
    await setSetting(db, "grup_ai_jid", jidIni);
    await setSetting(db, "grup_ai_aktif", "1");
    const tersedia = await penyediaTersedia(db);
    const mode = await getSetting(db, "grup_ai_mode");
    const strategi = await getSetting(db, "grup_ai_strategi");
    return [
      "*AI grup aktif* di grup ini 🤖",
      mode === "semua"
        ? "Aku jawab setiap pesan teks."
        : mode === "pertanyaan"
          ? "Aku jawab pesan berawalan */ai*, pesan berbentuk pertanyaan, atau kalau aku di-mention / balas pesanku."
          : "Tanya aku dengan awalan */ai*, contoh: `/ai apa itu fotosintesis?` (atau balas pesanku buat lanjut ngobrol).",
      tersedia.length
        ? strategi === "giliran"
          ? `Penyedia bergiliran: ${tersedia.map((p) => LABEL_PENYEDIA[p]).join(" → ")}.`
          : `Tiap pertanyaan dijawab bersama oleh ${tersedia.map((p) => LABEL_PENYEDIA[p]).join(" + ")}, lalu digabung jadi satu jawaban terbaik.`
        : "⚠️ Belum ada penyedia AI yang tersambung (atur di website → Koneksi).",
      "Perintah pemilik: `!aigrup status` · `mati` · `mode perintah|pertanyaan|semua` · `strategi gabung|giliran` · `reset`",
    ].join("\n");
  }
  if (!aktifDiIni) return null; // perintah lain hanya berlaku di grup yang sedang dipilih
  if (kata === "mati" || kata === "off") {
    await setSetting(db, "grup_ai_aktif", "0");
    return "AI grup dimatikan. Ketik `!aigrup aktif` untuk menyalakan lagi.";
  }
  if (kata === "strategi" || kata === "cara") {
    const m = sisa[0];
    if (m !== "gabung" && m !== "giliran") return "Pakai: `!aigrup strategi gabung` (semua penyedia dijawab sekaligus lalu digabung) atau `!aigrup strategi giliran` (bergantian, hemat kuota).";
    await setSetting(db, "grup_ai_strategi", m);
    return m === "gabung" ? "Oke, tiap pertanyaan sekarang dijawab bersama oleh semua penyedia lalu digabung jadi satu jawaban terbaik." : "Oke, sekarang penyedia bergiliran: satu penyedia per pertanyaan.";
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
    const [aktif, mode, batas, tersedia, pakai, modelC, strategiC] = await Promise.all([
      getSetting(db, "grup_ai_aktif"),
      getSetting(db, "grup_ai_mode"),
      getSettingNumber(db, "grup_ai_batas_harian"),
      penyediaTersedia(db),
      pemakaianGrupHariIni(db, now),
      getSetting(db, "grup_ai_model_claude"),
      getSetting(db, "grup_ai_strategi"),
    ]);
    return [
      `*AI grup:* ${aktif === "1" ? "aktif" : "mati"} · mode ${mode}`,
      `Cara menjawab: ${strategiC === "giliran" ? "bergiliran" : "gabungan semua penyedia"}`,
      `Model Claude: ${modelC === "otomatis" ? "otomatis (Haiku ringan · Sonnet kuliah/koding · Opus sangat berat)" : modelC}`,
      `Pemakaian hari ini: ${pakai}${batas > 0 ? ` / ${batas}` : " (tanpa batas)"}`,
      `Penyedia: ${tersedia.length ? tersedia.map((p) => LABEL_PENYEDIA[p]).join(" + ") : "belum ada"}`,
    ].join("\n");
  }
  return "Perintah: `!aigrup aktif` · `mati` · `status` · `mode perintah|pertanyaan|semua` · `strategi gabung|giliran` · `reset`";
}

// ---------------------------------------------------------------- pesan grup

export type StrategiGrup = "gabung" | "giliran";

interface Draf {
  penyedia: Penyedia;
  model?: string;
  teks: string;
}

const URUT_UTAMA: readonly Penyedia[] = ["claude", "gemini", "openrouter", "groq"];
/**
 * Waktu tunggu penyedia lain setelah draf pertama masuk. Claude CLI biasanya 10–15 dtk (Opus bisa 40+ dtk) sedangkan Gemini ±1–2 dtk,
 * jadi tenggang harus cukup panjang supaya jawaban Claude ikut tergabung; soal berat menunggu lebih lama.
 */
const TENGGANG_MS: Record<TingkatSoal, number> = { ringan: 15_000, berat: 30_000, sangat_berat: 60_000 };

/** Nama model untuk ditampilkan di bawah jawaban: "nvidia/nemotron-3-super:free" → "nemotron-3-super". */
const modelPendek = (m?: string) => (m ?? "").replace(/^[^/]+\//, "").replace(/:free$/, "");

interface PermintaanDraf {
  prompt: string;
  gambar?: string;
  modelClaude?: string;
}

/** Kirim ke semua penyedia sekaligus. Selesai kalau semuanya sudah menjawab, atau `tenggang` ms setelah draf pertama berhasil. */
function kumpulkanDraf(db: Db, tersedia: readonly Penyedia[], r: PermintaanDraf, now: Date, tenggang: number): Promise<Draf[]> {
  return new Promise((resolve) => {
    const draf: Draf[] = [];
    let selesai = 0;
    let tuntas = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const akhiri = () => {
      if (tuntas) return;
      tuntas = true;
      if (timer) clearTimeout(timer);
      resolve(URUT_UTAMA.map((p) => draf.find((d) => d.penyedia === p)).filter((d): d is Draf => !!d)); // urutan tetap: Claude, Gemini, OpenRouter
    };
    for (const p of tersedia) {
      panggilAI(db, { fitur: "chat_grup", system: SYSTEM_GRUP, prompt: r.prompt, now, timeoutMs: p === "claude" && r.modelClaude === "opus" ? 120_000 : 60_000, penyedia: p, model: p === "claude" ? r.modelClaude : undefined, gambar: r.gambar })
        .then((h) => {
          const teks = h.ok ? bersihkanBalasan(h.teks) : "";
          if (teks) {
            draf.push({ penyedia: p, model: h.ok ? h.model : undefined, teks });
            if (!timer && !tuntas) timer = setTimeout(akhiri, tenggang);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (++selesai === tersedia.length) akhiri();
        });
    }
  });
}

/**
 * Urutan penyedia untuk tahap penggabungan. Gemini dulu: cepat (±1–2 dtk), gratis, dan tidak memakai kuota langganan Claude
 * (penggabungan lewat Claude CLI menambah ±10 dtk). Soal sangat berat: Claude dulu demi kerapian, kecuali kuota langganannya tinggi.
 */
async function urutanPenggabung(db: Db, tersedia: readonly Penyedia[], tingkat: TingkatSoal, now: Date): Promise<Penyedia[]> {
  const ada = (p: Penyedia) => tersedia.includes(p);
  const tinggi = (await batasClaude(db, now)).some((j) => (j.kode === "five_hour" ? j.persen >= 70 : j.persen >= 85));
  const claudeDulu = tingkat === "sangat_berat" && !tinggi;
  // Gemini dan Groq cepat; Groq jadi cadangan penggabung berikutnya
  const urut: Penyedia[] = claudeDulu ? ["claude", "gemini", "groq", "openrouter"] : ["gemini", "groq", "openrouter", "claude"];
  return urut.filter(ada);
}

/** Gabungkan beberapa draf jadi satu jawaban. null = semua penyedia gagal menggabungkan. */
async function gabungkan(db: Db, draf: Draf[], promptDasar: string, ada_foto: boolean, tingkat: TingkatSoal, tersedia: readonly Penyedia[], now: Date): Promise<{ teks: string; penyedia: Penyedia; model?: string } | null> {
  const huruf = ["A", "B", "C", "D"];
  const prompt = [
    promptDasar,
    ada_foto ? "(Penanya melampirkan sebuah gambar; draf di bawah sudah melihatnya.)" : "",
    "",
    "# Draf jawaban",
    ...draf.map((d, i) => `## Jawaban ${huruf[i]}\n${d.teks}`),
    "",
    "Tulis SATU jawaban final terbaik untuk pesan baru di atas.",
  ].join("\n");
  const modelClaude = await modelClaudeGrup(db, tingkat === "sangat_berat" ? "berat" : tingkat, now); // menggabungkan tidak perlu Opus
  for (const p of await urutanPenggabung(db, tersedia, tingkat, now)) {
    const h = await panggilAI(db, { fitur: "chat_grup", system: SYSTEM_GRUP + SYSTEM_EDITOR, prompt, now, timeoutMs: 60_000, penyedia: p, model: p === "claude" ? modelClaude : undefined });
    const teks = h.ok ? bersihkanBalasan(h.teks) : "";
    if (teks) return { teks, penyedia: p, model: h.ok ? h.model : undefined };
  }
  return null;
}

const bersihNama = (n: string | undefined, nomor: string) => (n ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 30) || `+${nomor.slice(-4)}`;

/**
 * Proses satu pesan grup. Mengembalikan teks balasan untuk dikirim ke grup, atau null (diabaikan).
 * `opsi.mengetik` dipanggil sekali sebelum menunggu AI.
 */
export async function prosesPesanGrup(db: Db, m: IncomingWaMessage, now: Date, opsi: { mengetik?: () => void; /** tes: waktu tunggu setelah draf pertama (ms) */ tenggang?: number } = {}): Promise<string | null> {
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
  const isiMentah = awalan ? awalan[1].trim() : teks;
  const kutip = g.kutipan;
  const sumberGambar = m.gambar ?? kutip?.gambar; // foto yang dikirim bersama /ai, atau foto yang dibalas
  const pantas = !!awalan || g.disapa || (mode === "semua" ? teks.length >= 2 : mode === "pertanyaan" && adalahPertanyaan(teks));
  if (!pantas) return null;
  if (BANTUAN_RE.test(isiMentah)) return BANTUAN;
  if (!sumberGambar && pertanyaanIdentitas(isiMentah)) return IDENTITAS;
  if (!isiMentah && !sumberGambar && !kutip?.teks) return bolehBeritahu(`bantuan:${m.nomor}`, now, 60_000) ? "Tulis pertanyaannya setelah */ai*, contoh: `/ai apa itu fotosintesis?` (ketik `/ai bantuan` buat lihat yang bisa kulakukan)" : null;
  const isi = isiMentah || (sumberGambar ? "Jelaskan apa yang ada di gambar ini." : "Tanggapi atau jelaskan pesan yang dibalas ini.");

  // ---- batas: per orang per menit, lalu per hari untuk seluruh grup
  const nama = bersihNama(g.nama, m.nomor);
  // 0 = tanpa batas (bawaan); batas dari penyedia sendiri (kuota gratis, langganan) tetap berlaku di luar sini
  const maksMenit = Math.max(0, (await getSettingNumber(db, "grup_ai_per_orang_menit")) || 0);
  if (maksMenit > 0) {
    const jejak = (jejakOrang.get(m.nomor) ?? []).filter((t) => now.getTime() - t < 60_000);
    if (jejak.length >= maksMenit) {
      jejakOrang.set(m.nomor, jejak);
      return bolehBeritahu(`pelan:${m.nomor}`, now, 5 * 60_000) ? `Pelan-pelan ya ${nama}, maks ${maksMenit} pertanyaan per menit 😊` : null;
    }
    jejak.push(now.getTime());
    jejakOrang.set(m.nomor, jejak);
    if (jejakOrang.size > 500) jejakOrang.delete(jejakOrang.keys().next().value!);
  }

  const batas = Math.max(0, (await getSettingNumber(db, "grup_ai_batas_harian")) || 0);
  if (batas > 0 && (await pemakaianGrupHariIni(db, now)) >= batas) {
    return bolehBeritahu(`habis:${wibDate(now)}`, now, 24 * 3600_000) ? `Jatah AI grup hari ini (${batas} pertanyaan) sudah habis. Lanjut besok ya 🙏` : null;
  }

  let tersedia = await penyediaTersedia(db);
  if (!tersedia.length) return bolehBeritahu("kosong", now, 3600_000) ? "AI grup belum bisa dipakai: belum ada penyedia AI yang tersambung." : null;

  // ---- foto (kalau ada): simpan sementara; hanya penyedia yang bisa membaca gambar yang ikut bergiliran
  let foto: { dir: string; nama: string; file: string } | null = null;
  const bersihFoto = () => {
    if (foto) fs.rmSync(foto.dir, { recursive: true, force: true });
  };
  if (sumberGambar) {
    try {
      const buf = await sumberGambar();
      const ext = jenisGambar(buf);
      if (!ext || buf.length > MAKS_GAMBAR) return "Fotonya nggak bisa kubaca (formatnya belum didukung atau terlalu besar). Coba kirim ulang ya 🙏";
      fs.mkdirSync(AI_WORK_DIR(), { recursive: true, mode: 0o700 });
      const dir = fs.mkdtempSync(path.join(AI_WORK_DIR(), "grup-foto-"));
      const nama = `foto.${ext}`;
      const file = path.join(dir, nama);
      fs.writeFileSync(file, buf, { mode: 0o600 });
      foto = { dir, nama, file };
    } catch {
      return "Fotonya gagal diunduh. Coba kirim ulang ya 🙏";
    }
    // OpenRouter dengan model terpasang bisa jadi tidak mendukung gambar (dan gagalnya bisa menahan model itu untuk teks);
    // dalam mode otomatis (tanpa model terpasang) model yang dipilih sudah disaring yang bisa membaca gambar.
    const orTerpasang = !!(await getSetting(db, "ai_openrouter_model"));
    // Groq tidak dipakai untuk gambar
    tersedia = tersedia.filter((p) => p !== "groq" && (p !== "openrouter" || !orTerpasang));
    if (!tersedia.length) {
      bersihFoto();
      return "Belum ada penyedia yang bisa membaca foto (butuh Claude atau Gemini).";
    }
  }

  // ---- percakapan terakhir di grup (ingatan pendek) → prompt tanpa data keuangan
  const kanal = `grup:${g.jid}`;
  const lalu = (await db.aiChat.findMany({ where: { kanal, waktu: { gte: new Date(now.getTime() - 3 * 3600_000) } }, orderBy: { id: "desc" }, take: 10 })).reverse();
  const prompt = [
    lalu.length ? ["# Percakapan terakhir di grup", ...lalu.map((r) => r.isi), ""].join("\n") : "",
    kutip?.teks ? [`# Pesan yang dibalas (dari ${kutip.dariBot ? "asisten" : "anggota grup"})`, kutip.teks.slice(0, 1200), ""].join("\n") : "",
    foto ? ["# Gambar", `Gambar terlampir: ./${foto.nama} (buka dan lihat file gambar ini sebelum menjawab).`, ""].join("\n") : "",
    `# Pesan baru dari ${nama}`,
    isi,
  ].join("\n");

  // model Claude dipilih dari beratnya soal (haiku / sonnet / opus); penyedia lain memakai model otomatisnya sendiri
  const tingkat = tingkatSoal(isi, { gambar: !!foto, kutipan: kutip?.teks });
  const modelClaude = await modelClaudeGrup(db, tingkat, now);
  const strategi = (await getSetting(db, "grup_ai_strategi")) === "giliran" ? "giliran" : "gabung";
  const tampilTanda = (await getSetting(db, "grup_ai_tanda")) === "1";
  const promptPenuh = prompt; // dengan bagian "# Gambar" (untuk penyedia yang membaca gambar)
  const promptDasar = prompt.replace(/# Gambar\nGambar terlampir:[^\n]*\n\n?/, ""); // tahap penggabungan tidak melihat gambar

  try {
    opsi.mengetik?.();
    let jawaban = "";
    let tanda = "";

    if (strategi === "gabung" && tersedia.length >= 2) {
      // ---- gabungan: tanya semua penyedia sekaligus, lalu satukan jadi satu jawaban terbaik
      const draf = await kumpulkanDraf(db, tersedia, { prompt: promptPenuh, gambar: foto?.file, modelClaude }, now, opsi.tenggang ?? TENGGANG_MS[tingkat]);
      if (draf.length === 1) {
        jawaban = draf[0].teks; // hanya satu yang menjawab: tidak ada yang digabung
        tanda = `via ${LABEL_PENYEDIA[draf[0].penyedia]}${draf[0].model ? ` · ${modelPendek(draf[0].model)}` : ""}`;
      } else if (draf.length > 1) {
        const akhir = await gabungkan(db, draf, promptDasar, !!foto, tingkat, tersedia, now);
        if (akhir) {
          jawaban = akhir.teks;
          tanda = `digabung dari ${draf.map((d) => `${LABEL_PENYEDIA[d.penyedia]}${d.model ? ` · ${modelPendek(d.model)}` : ""}`).join(", ")}`;
        } else {
          jawaban = draf[0].teks; // penggabungan gagal: pakai draf terbaik (urutan Claude, Gemini, OpenRouter)
          tanda = `via ${LABEL_PENYEDIA[draf[0].penyedia]}${draf[0].model ? ` · ${modelPendek(draf[0].model)}` : ""}`;
        }
      }
    } else {
      // ---- bergiliran (round robin): satu penyedia per pertanyaan, berikutnya sebagai cadangan kalau gagal
      const urutan = urutanGiliran(tersedia, await giliranBerikut(db));
      for (const p of urutan) {
        const h = await panggilAI(db, { fitur: "chat_grup", system: SYSTEM_GRUP, prompt: promptPenuh, now, timeoutMs: p === "claude" && modelClaude === "opus" ? 120_000 : 60_000, penyedia: p, model: p === "claude" ? modelClaude : undefined, gambar: foto?.file });
        if (!h.ok) continue; // penyedia ini gagal: langsung giliran berikutnya (alasan teknis tercatat di log panggilan AI)
        jawaban = bersihkanBalasan(h.teks);
        if (!jawaban) continue;
        tanda = `via ${LABEL_PENYEDIA[h.penyedia ?? p]}${h.model ? ` · ${h.model}` : ""}`;
        break;
      }
    }

    if (!jawaban) return bolehBeritahu("gagal", now, 10 * 60_000) ? "Maaf, layanan AI lagi sibuk atau bermasalah. Coba lagi sebentar ya 🙏" : null;
    await db.aiChat.createMany({
      data: [
        { kanal, peran: "user", isi: `${nama}: ${isi}${foto ? " [mengirim foto]" : ""}`, waktu: now },
        { kanal, peran: "asisten", isi: `Asisten: ${jawaban}`.slice(0, 1500), waktu: new Date(now.getTime() + 1) },
      ],
    });
    await catatJawabanGrup(db, now);
    return `${jawaban}${tampilTanda ? `\n\n_${tanda}_` : ""}`;
  } finally {
    bersihFoto();
  }
}
