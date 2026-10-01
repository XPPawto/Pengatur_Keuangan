import type { Db } from "../db";

export const DEFAULT_SETTINGS = {
  nama_pengguna: "Abdul",
  /** Pengeluaran Darurat di atas nominal ini masuk mode tahan belanja dulu. */
  batas_tahan: "25000",
  /** Izinkan login website pakai kode yang dikirim ke WhatsApp. */
  otp_login: "1",
  /** Pembagian default uang tambahan (kiriman Ayah, uang ekstra), dalam persen per amplop. */
  bagi_ekstra: "kado:50,darurat:50",
  /** Nama pengirim default untuk kiriman tambahan. */
  pengirim_default: "Ayah",
  /** Asisten AI (Claude Code CLI dengan token langganan). */
  ai_aktif: "1",
  /** Maksimal pemanggilan AI per hari (menjaga kuota langganan). */
  ai_batas_harian: "40",
  /** Model untuk ngobrol, struk, review (alias Claude Code: sonnet | opus | haiku). */
  ai_model: "sonnet",
  /** Model untuk tugas kecil (tebak kategori, cek koneksi). */
  ai_model_ringan: "haiku",
  /** AI menjawab pesan WhatsApp yang tidak dipahami perintah biasa. */
  ai_pesan_bebas: "1",
  /** Foto struk dibaca Claude (fallback OCR lokal). */
  ai_struk: "1",
  /** Evaluasi & tantangan dari AI di rekap Sabtu. */
  ai_review: "1",
  /** AI menebak amplop untuk kata yang belum dikenal. */
  ai_tebak_kategori: "1",
  /** Penyedia AI cadangan saat Claude tidak bisa dipakai. */
  ai_claude_aktif: "1",
  ai_gemini_aktif: "0",
  ai_gemini_model: "gemini-3.6-flash",
  ai_gemini_model_ringan: "gemini-3.5-flash-lite",
  /** pindah ke model lain otomatis kalau model yang dipilih penuh / timeout / ditutup (Gemini & OpenRouter) */
  ai_gemini_auto: "1",
  // ---- AI grup WhatsApp: asisten umum (tanpa data DompetKos) untuk SATU grup, penyedia bergiliran
  /** JID grup yang dilayani (…@g.us); diisi lewat perintah `!aigrup aktif` di grup oleh pemilik, atau di website */
  grup_ai_jid: "",
  grup_ai_aktif: "0",
  /** perintah = hanya pesan berawalan /ai (atau bot di-mention / pesan bot dibalas); pertanyaan = ditambah pesan berbentuk pertanyaan; semua = setiap pesan teks */
  grup_ai_mode: "perintah",
  /** batas jawaban AI grup per hari; 0 = tanpa batas (bawaan). Batas dari penyedia (kuota gratis, langganan) tetap berlaku */
  grup_ai_batas_harian: "0",
  /** maks pertanyaan per orang per menit; 0 = tanpa batas (bawaan) */
  grup_ai_per_orang_menit: "0",
  /** cetak nama penyedia & model di bawah jawaban */
  grup_ai_tanda: "1",
  /** model Claude saat giliran Claude di grup: otomatis (haiku ringan / sonnet kuliah & koding / opus sangat berat), haiku, sonnet, opus, atau bawaan (ikut pengaturan Asisten) */
  grup_ai_model_claude: "otomatis",
  /** hitungan internal untuk giliran penyedia (round robin) */
  grup_ai_putaran: "0",
  /** gabung = tiap pertanyaan dikirim ke semua penyedia sekaligus lalu jawabannya disatukan jadi yang terbaik (bawaan); giliran = satu penyedia per pertanyaan, bergantian (hemat kuota) */
  grup_ai_strategi: "gabung",
  /** hitungan internal jawaban hari ini: "YYYY-MM-DD:jumlah" */
  grup_ai_hitung: "",
  // ---- memori asisten (ala Hermes Agent)
  /** batas karakter memori Profil / Catatan milik pemilik (ruang lain lebih kecil) */
  memori_batas_profil: "1400",
  memori_batas_catatan: "2200",
  /** asisten boleh menyimpan / merapikan memori sendiri lewat perenungan otomatis */
  memori_belajar: "1",
  /** perenungan setelah sekian pesan pemilik, dan juga saat obrolan berhenti sekian menit */
  memori_refleksi_tiap: "3",
  memori_refleksi_idle_menit: "15",
  /** sisipkan potongan obrolan lama yang relevan ke prompt */
  memori_ingatan_obrolan: "1",
  /** penanda internal: id AiChat terakhir yang sudah diindeks */
  memori_indeks_sampai: "0",
  // penanda perenungan otomatis: id AiChat terakhir yang sudah dibaca ("" = belum diinisialisasi) dan waktu percobaan terakhir
  memori_refleksi_id: "",
  memori_refleksi_coba: "",
  ai_openrouter_auto: "1",
  ai_groq_aktif: "0",
  /** Groq: model utama & model tugas kecil; pindah model otomatis kalau penuh / batas / dihentikan */
  ai_groq_model: "llama-3.3-70b-versatile",
  ai_groq_model_ringan: "llama-3.1-8b-instant",
  ai_groq_auto: "1",
  ai_openrouter_aktif: "0",
  /** wajib model gratis (berakhiran ":free"); kosong = pilih otomatis model gratis pertama */
  ai_openrouter_model: "",
  /** urutan cadangan setelah Claude */
  ai_urutan_cadangan: "gemini,openrouter",
} as const;
export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSetting(db: Db, key: SettingKey): Promise<string> {
  const row = await db.setting.findUnique({ where: { kunci: key } });
  return row?.nilai ?? DEFAULT_SETTINGS[key];
}

export async function getSettingNumber(db: Db, key: SettingKey): Promise<number> {
  const n = Number(await getSetting(db, key));
  return Number.isFinite(n) ? n : Number(DEFAULT_SETTINGS[key]);
}

export async function setSetting(db: Db, key: SettingKey, nilai: string) {
  await db.setting.upsert({ where: { kunci: key }, update: { nilai }, create: { kunci: key, nilai } });
}

export async function getAllSettings(db: Db): Promise<Record<SettingKey, string>> {
  const rows = await db.setting.findMany();
  const out = { ...DEFAULT_SETTINGS } as Record<SettingKey, string>;
  for (const r of rows) if (r.kunci in out) out[r.kunci as SettingKey] = r.nilai;
  return out;
}
