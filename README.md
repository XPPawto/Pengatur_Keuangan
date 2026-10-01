# DompetKos

Website + bot WhatsApp untuk mengatur uang mingguan Rp300.000 dengan **sistem amplop**: Makan, Paket data, Paylater, Tabungan kado, dan Darurat & kos.
Catat dari WhatsApp (`tempe 5k`), langsung dibalas sisa uang dan jatah makan hari ini. Website untuk gambaran besar, anggaran, tagihan, target, belanja, dan rekap.

Semua fase PRD (1–3) sudah dikerjakan, ditambah fitur lanjutan: **undo untuk semua aksi & riwayat aktivitas**, **rekonsiliasi dengan uang asli**, **kiriman Ayah di luar uang mingguan**, **autopilot** (proyeksi, simulasi "kalau…", saran sekali `ok`, deteksi pola), **hutang-piutang & patungan**, **skor/level/lencana**, **foto struk dibaca otomatis (OCR lokal, gratis)**, **harga yang belajar sendiri**, **kesehatan sistem + alarm**, laporan untuk orang tua, login kode WhatsApp, dan CI. Plus **asisten AI Claude** yang memakai langganan Claude Pro lo sendiri lewat Claude Code (tanpa API key, tanpa tagihan per token) dan **peta koneksi** WhatsApp + Claude. Tanpa layanan berbayar tambahan.

---

## Daftar isi

1. [Fitur](#1-fitur)
2. [Install](#2-install)
3. [Isi `.env`](#3-isi-env)
4. [Menjalankan](#4-menjalankan)
5. [Menyambungkan WhatsApp](#5-menyambungkan-whatsapp-dari-website)
6. [Perintah bot](#6-perintah-bot)
7. [Nomor keluarga (orang tua)](#7-nomor-keluarga-orang-tua)
8. [Pengingat otomatis](#8-pengingat-otomatis)
9. [Aturan hitung](#9-aturan-hitung)
10. [Backup & ekspor](#10-backup--ekspor)
11. [Untuk developer](#11-untuk-developer)
12. [Asisten AI (Claude, pakai langganan)](#12-asisten-ai-claude-pakai-langganan)
13. [Keamanan](#13-keamanan)

---

## 1. Fitur

**Website** (mobile-first, mode gelap mengikuti HP, ikon SVG, bisa dipasang ke layar utama HP sebagai aplikasi)

| Halaman | Isi |
| --- | --- |
| Beranda | Jatah makan hari ini (angka besar + status), streak, progres kado, dana darurat, uang diselamatkan, saldo semua amplop, tagihan terdekat dengan hitung mundur, transaksi hari ini |
| Catat | Form cepat (format nominal sama dengan bot), pilih amplop, tanggal (catat mundur), tombol cepat item belanja, **foto struk** (total atau per item), tandai "tidak jajan" |
| Riwayat | Transaksi per periode, filter amplop, cari catatan, ubah/hapus, sumber WA/Web, pesan WA asli, daftar pindah amplop, unduh CSV |
| Amplop & anggaran | Saldo, pindah antar amplop (wajib alasan), **cocokkan dengan uang asli**, **koreksi uang mingguan**, koreksi alokasi, nominal default, urutan potong, kunci, rencana per minggu |
| Tagihan | Tagihan belum lunas + kesiapan dana (cukup/kurang), tandai lunas (dicatat dari amplop sumber), ubah/hapus, tambah tagihan, riwayat lunas |
| Target | Tabungan kado: terkumpul, proyeksi saat tenggat, perkiraan tanggal tembus minimal, grafik kumulatif aktual vs rencana, ubah target |
| Belanja mingguan | Daftar belanja dengan harga yang bisa diedit, total vs budget (aman/lewat), centang saat belanja, lauk rotasi 4 minggu, menu 7 hari tanpa sayur (bisa diedit) |
| Rekap | Grafik pengeluaran per amplop per minggu, makan per hari vs jatah, disiplin mencatat, uang diselamatkan, mode tahan belanja |
| Autopilot | Proyeksi 8 minggu (kado, darurat, paylater) dari pola belanja nyata, risiko, saran pindah uang sekali klik, simulator "kalau beli…/kalau uang masuk…", pola & kebiasaan |
| Hutang-piutang | Uang di teman & utang lo, catat/bayar sebagian/lunas, patungan bagi rata |
| Prestasi | Skor mingguan 0–100, level & XP, tantangan otomatis, 10 lencana, riwayat skor |
| Aktivitas | Jejak semua perubahan (siapa, kapan, dari WA/web) dan tombol Batalkan untuk tiap aksi |
| Asisten AI | Chat dengan Claude soal duit lo (pertanyaan, rencana menu, kenapa boros, target kado, draf pesan ke ortu), usulan aksi yang dijalankan setelah disetujui, memori, kata yang dipelajari, saklar fitur & batas harian |
| Kesehatan sistem | Status bot, WhatsApp, antrean pesan, backup, penyimpanan, asisten AI; endpoint `/api/health` |
| Koneksi | **Peta node realtime** DompetKos ↔ WhatsApp (nomor pemilik, keluarga, antrean) ↔ Claude (fitur AI): titik cahaya berjalan di garis setiap ada pesan WA masuk/keluar dan setiap Claude dipanggil (node Claude berdenyut selama mikir, balik hijau/merah), log aktivitas langsung tanpa isi pesan, bisa digeser & zoom; pairing WhatsApp (QR/kode); token Claude; **batas langganan sesi 5 jam & mingguan** + jam reset; **pemakaian Claude** (panggilan, token, waktu jawab, grafik harian, log) |
| Pengaturan | Nomor penerima & perannya, jadwal pengingat, nama, batas tahan belanja, login kode WA, ekspor Excel/CSV, backup & unduh backup, antrean pesan otomatis |

Semua grafik punya tooltip saat disentuh dan tampilan tabel. Transaksi dari WhatsApp muncul di website dalam ±4 detik tanpa refresh.

**Bot WhatsApp**: catat bebas format, tanya balik kalau kategori tidak jelas (atau ditebak AI, lalu bot belajar), jatah harian otomatis, pindah amplop, bayar tagihan, tahan belanja, rekap, target, daftar belanja & menu, pengingat terjadwal, laporan sopan untuk orang tua.

## 2. Install

Butuh Node.js 20+ dan **nomor WhatsApp cadangan** untuk bot (bukan nomor utama, bukan salah satu nomor penerima).

```bash
git clone <repo-ini> dompetkos
cd dompetkos
npm install
npm run setup
```

`npm run setup` membuat `.env` dengan kunci acak dan **password login awal acak** (dicetak sekali, catat!), membuat database `data/dompetkos.db`, dan mengisi data awal PRD: amplop, rencana pembagian 4 Okt–29 Nov 2026, tagihan paylater, target kado Rp800–900rb, daftar belanja, menu 7 hari, lauk rotasi, jadwal pengingat, dan nomor orang tua.

Ganti password:

```bash
npm run set-password passwordBaruMinimal8
# salin baris APP_PASSWORD_HASH=... ke .env, lalu restart
```

## 3. Isi `.env`

| Variabel | Isi |
| --- | --- |
| `DATABASE_URL` | Default `file:../data/dompetkos.db` (relatif ke folder `prisma/`) |
| `OWNER_WA_NUMBERS` | Nomor pemilik (bisa mencatat), format internasional, pisah koma. Default `6285163544535,628971688893` |
| `FAMILY_WA_NUMBERS` | Nomor keluarga (hanya terima laporan). Default `628979936381` (orang tua). Bisa juga diatur dari halaman Pengaturan |
| `APP_PASSWORD_HASH` | Hash password website (`npm run set-password`) |
| `SESSION_SECRET` | Kunci acak untuk cookie login |
| `WA_SESSION_DIR` | Folder sesi WhatsApp. Default `./data/wa-session` |
| `BACKUP_DIR` | Folder backup. Default `./data/backups` |
| `COOKIE_SECURE` | Isi `1` kalau website dibuka lewat HTTPS |
| `CLAUDE_CODE_OAUTH_TOKEN` | Opsional. Token `claude setup-token` untuk asisten AI. Lebih praktis ditempel di website (Koneksi → Claude, disimpan terenkripsi) |
| `CLAUDE_BIN` | Opsional. Lokasi perintah `claude` kalau tidak ada di PATH |
| `AI_CONFIG_DIR` | Opsional. Folder konfigurasi Claude Code khusus bot. Default `./data/claude-config` |

`.env` dan folder `data/` (database, sesi WhatsApp, backup) tidak pernah masuk git.

## 4. Menjalankan

```bash
npm run dev        # development: web (http://localhost:3000) + bot sekaligus
```

Pemakaian harian:

```bash
npm run build
npm start          # web + bot, mode produksi
```

Supaya tetap hidup setelah terminal ditutup / laptop restart (gratis):

```bash
npm i -g pm2
pm2 start npm --name dompetkos -- start
pm2 save && pm2 startup
```

**Pasang di iPhone (jadi aplikasi):** buka website di **Safari** → tombol **Bagikan** → **Tambah ke Layar Utama**. DompetKos terbuka layar penuh seperti aplikasi: ikon & layar pembuka sendiri (terang/gelap, termasuk iPhone 13), pas dengan poni & home indicator, input tidak bikin layar membesar, **tarik ke bawah untuk muat ulang**, dan halaman "Lagi offline" kalau internet putus. Login sekali di aplikasinya (cookie aplikasi terpisah dari Safari). Data pribadi tidak pernah disimpan di cache HP.

Di HP Android bekas (Termux): `pkg install nodejs git`, langkah sama, lalu `termux-wake-lock`.
Buka dari HP di Wi-Fi yang sama: `http://<ip-laptop>:3000`, lalu "Tambahkan ke layar utama" supaya terasa seperti aplikasi.

**Mau lihat dulu tanpa data asli?** Isi database demo 4 minggu:

```bash
DATABASE_URL="file:../data/demo.db" npm run demo
DATABASE_URL="file:../data/demo.db" npm run dev
```

## 5. Menyambungkan WhatsApp (dari website)

1. Jalankan web + bot. Kalau bot mati atau WhatsApp terputus, semua halaman menampilkan banner merah.
2. Login → menu **Koneksi** (peta koneksi + panel WhatsApp).
3. **Hubungkan lewat QR**: di HP bot buka WhatsApp → *Perangkat tertaut* → *Tautkan perangkat* → scan. QR diperbarui otomatis.
   Atau **Pakai kode pairing**: isi nomor bot, ketik kode 8 huruf di *Tautkan dengan nomor telepon*.
4. Status berubah jadi **Terhubung** tanpa refresh. Kirim `bantuan` dari nomor pemilik.
5. **Putuskan** melepas perangkat tertaut dan menghapus sesi di server.

> Bot memakai [Baileys](https://github.com/WhiskeySockets/Baileys) (tidak resmi). Gratis dan bebas kirim pengingat, tapi nomor bot **bisa diblokir kapan saja** — karena itu wajib nomor cadangan. Koneksi dibungkus interface `WhatsAppGateway`, jadi bisa pindah ke WhatsApp Cloud API resmi tanpa mengubah logika.

## 6. Perintah bot

| Pesan | Hasil |
| --- | --- |
| `tempe 5k` · `beli telur 14rb` | Catat ke amplop yang ditebak dari kata kunci, balas sisa + jatah hari ini |
| `tempe 5k sama telur 14k` | Banyak catatan sekaligus (pemisah: `sama`, `dan`, `,`, `+`, baris baru) |
| *(kirim foto struk)* | Dibaca otomatis → `ok` catat total, `rinci` catat per item, angka pilih amplop |
| `kemarin tempe 5k` | Catat untuk kemarin |
| `ojek 10k` | Kategori tidak jelas → bot tanya pilihan bernomor |
| `batal` | **Batalkan aksi terakhir apa pun** (catat, bayar tagihan, pindah, uang masuk, kiriman, hutang, …) |
| `ubah 12k` | Ganti nominal catatan terakhir |
| `aktivitas` | 8 aksi terakhir + siapa pelakunya |
| `nol` · `gak jajan` | Tandai hari ini tanpa jajan |
| `sisa` · `jatah` · `hari ini` · `rekap` · `target` · `tagihan` | Cek kondisi |
| `skor` | Skor minggu ini, level, lencana, tantangan |
| `masuk 300` · `gajian 300rb` | Uang mingguan masuk → usulan pembagian → `ok` |
| `ayah kirim 100k` · `dari ayah 50rb` · `kiriman 100k` | **Kiriman di luar uang mingguan** → usulan bagi → `ok` atau pilih amplop |
| `koreksi masuk 300` | Betulkan nominal uang mingguan yang salah ketik |
| `saldo asli 412k` | **Cocokkan catatan dengan uang asli**; selisih dicatat/diabaikan |
| `bayar paylater 50k` | Bayar dari amplop Paylater & tandai lunas |
| `pindah 10k darurat ke makan alasan ...` | Pindah antar amplop (dari Tabungan kado wajib `YAKIN AMBIL TABUNGAN`) |
| `mau beli headset 60k` | Tahan belanja: tunda 24 jam / beli / gak jadi |
| `proyeksi` | Saldo 6 minggu ke depan + risiko |
| `kalau beli sepatu 150k` · `kalau masuk 250 3 minggu` | Simulasi dampak ke kado, darurat, tagihan |
| `saran` | Saran pindah uang otomatis, jalankan sekaligus dengan `ok` |
| `pola` | Hari paling boros, jajan malam, item paling menyedot uang |
| `pinjemin budi 20k` · `budi pinjem 20k` | Teman pinjam (uang keluar dari Darurat) |
| `budi bayar 10k` · `budi lunas` | Teman bayar (uang kembali ke Darurat) |
| `pinjem ke andi 30k` · `bayar utang andi` | Lo pinjam / bayar utang |
| `patungan galon 18k sama budi andi` | Bagi rata: bagian lo dicatat, bagian teman jadi piutang |
| `utang` | Daftar utang-piutang aktif |
| `belanja` · `menu` · `bantuan` | Daftar belanja, menu hari ini, daftar perintah |

Nominal: `12k`, `12rb`, `12 ribu`, `12.000`, `12000`, `1,5jt`, `rp5.000`. Angka polos di bawah 1000 dianggap ribuan (`masuk 300` = Rp300.000).
Pengeluaran Darurat di atas Rp25.000 (bisa diatur) otomatis masuk mode tahan belanja dulu.

Coba tanpa WhatsApp:

```bash
npm run wa:sim -- 085163544535 "tempe 5k sama telur 14k"
```

## 7. Nomor keluarga (orang tua)

Nomor 08979936381 terdaftar sebagai **keluarga**: tidak bisa mencatat atau mengubah data, dan semua pesannya memakai bahasa sopan (bukan gw/lo).

- **Tanda terima uang**: saat uang mingguan dikonfirmasi, ortu menerima "Uang mingguan Rp300.000 sudah diterima Abdul …" beserta rencana penggunaannya.
- **Laporan mingguan** tiap Sabtu 20.00: uang diterima, total pengeluaran, rata-rata makan per hari, tagihan yang dibayar, dana darurat, tabungan, dan kedisiplinan mencatat.
- Ortu bisa membalas `laporan` kapan saja untuk ringkasan terbaru.
- **Kiriman tak tentu dari Ayah** (di luar Rp300rb): kalau Ayah membalas misalnya *"sudah transfer 100rb"*, kamu langsung dapat pesan untuk mengonfirmasi. Setelah kamu kirim `ayah kirim 100k` → `ok`, uangnya dibagi ke amplop (default 50% tabungan kado, 50% darurat; bisa diatur di Pengaturan atau dipilih per kiriman) dan Ayah menerima tanda terima. Kiriman dicatat terpisah dari uang mingguan, jadi laporan menulis "uang mingguan Rp300.000 + kiriman tambahan Rp100.000".

Semua bisa dinyalakan/dimatikan per nomor di **Pengaturan → Nomor WhatsApp**, termasuk menambah anggota keluarga lain.

## 8. Pengingat otomatis

| Waktu (WIB) | Isi | Penerima |
| --- | --- | --- |
| Minggu 09.00, ulang tiap 3 jam s.d. 21.00 | "Uang udah masuk?" — berhenti setelah dikonfirmasi | Pemilik |
| Setiap hari 07.00 | Jatah makan, menu hari ini, tagihan 3 hari ke depan | Pemilik |
| Setiap hari 21.00 | "Udah catat?" — hanya kalau belum ada catatan | Pemilik |
| H-3 & H-1 jatuh tempo, 09.00 | Tagihan: nominal, saldo amplop, cukup/kurang | Pemilik |
| Sabtu 19.00 | Saran autopilot (balas `ok` untuk jalankan) | Pemilik |
| Sabtu 20.00 | Rekap mingguan + skor + piutang yang belum kembali, plus evaluasi & tantangan dari asisten AI (kalau aktif) | Pemilik |
| Sabtu 20.00 | Laporan keluarga | Keluarga |
| 24 jam setelah tahan belanja | "Masih mau beli?" | Yang meminta |

Aturan anti-spam: **tidak ada pesan 22.00–06.00**, **maksimal 1 pesan otomatis per jam per nomor** (pesan yang jatuh bersamaan digabung jadi satu), pesan yang sudah basi dibuang. Jam dan status tiap pengingat bisa diubah di Pengaturan; antrean pesan terlihat di sana juga.

## 9. Aturan hitung

- **Jatah makan hari ini** = (sisa amplop Makan + yang sudah dipakai hari ini) ÷ sisa hari periode termasuk hari ini, dibulatkan ke bawah ke ratusan. Angkanya tetap sepanjang hari; kalau lewat, bot memberi tahu **jatah besok**. Contoh: sisa Rp61.000, 6 hari → Rp10.100.
- **Periode** Minggu–Sabtu, dimulai saat uang masuk dikonfirmasi. Sisa Makan minggu lalu pindah ke Darurat otomatis.
- **Uang kurang dari rencana**: potong Darurat dulu, lalu Tabungan kado, lalu Paylater (hanya jika tagihan berikutnya > 14 hari). Makan & Data tidak pernah dipotong otomatis. Dampak ke target kado ditampilkan.
- **Saldo tidak disimpan**, selalu dihitung dari alokasi − pengeluaran ± pindahan. Makan & Data per minggu; Paylater, Tabungan kado, Darurat menumpuk lintas minggu.
- **Tabungan kado terkunci**: mengambil dari sana (catat, pindah, buka kunci) wajib `YAKIN AMBIL TABUNGAN`.
- **Peringatan** satu kali saat amplop Makan/Data turun di bawah 20%. Warna: hijau aman, kuning sisa < 30%, merah lewat.

### Fitur lanjutan

- **Undo & riwayat aktivitas.** Setiap aksi yang mengubah data dicatat (siapa, kapan, dari WA/web, apa yang berubah) dan bisa dibatalkan — termasuk efek berantainya: membatalkan pembayaran tagihan mengembalikan status "belum lunas", membatalkan uang masuk mengaktifkan lagi periode lama. Transaksi yang dihapus bisa dipulihkan.
- **Rekonsiliasi.** Total uang menurut sistem = semua uang masuk − semua pengeluaran. Masukkan uang asli (dompet + e-wallet); selisihnya dicatat sebagai pengeluaran yang terlewat, uang ekstra, atau diabaikan.
- **Autopilot.** Proyeksi memakai rencana pembagian, tagihan yang belum lunas, dan rata-rata belanja nyata 4 minggu terakhir (kiriman tak tentu tidak dihitung, supaya konservatif). Saran hanya memindahkan uang di atas penyangga Darurat Rp30rb.
- **Hutang-piutang.** Uang yang dipinjamkan ikut keluar dari amplop dan kembali saat dibayar, jadi rekonsiliasi tetap cocok. Tidak dihitung sebagai belanja di rekap.
- **Skor mingguan (0–100):** disiplin mencatat 40 · makan dalam jatah 30 · hari tanpa jajan 10 · tahan belanja 10 · tagihan tidak telat 10.
- **Foto struk.** OCR berjalan di komputer sendiri dengan tesseract.js + data bahasa Indonesia/Inggris dari npm (tanpa internet, tanpa biaya). Struk minimarket terbaca baik; struk tulisan tangan sering gagal, jadi selalu ada konfirmasi.
- **Harga belajar sendiri.** Bot memberi tahu kalau harga item naik ≥15% dari biasanya; halaman Belanja menyarankan harga asli untuk daftar belanja.
- **Kesehatan sistem.** Halaman Sistem + alarm WA kalau backup terlambat, antrean pesan macet, atau disk hampir penuh (maks sekali sehari per masalah). `GET /api/health` untuk monitor uptime.

## 10. Backup & ekspor

- **Backup otomatis** tiap Sabtu 23.30 ke `data/backups/`, simpan 4 terakhir (salinan konsisten via `VACUUM INTO`). Bisa juga **Backup sekarang** dan **unduh** file backup dari Pengaturan — simpan salinannya di luar laptop.
- **Ekspor Excel** (Pengaturan / Rekap): sheet *Belanja Makan*, *Budget Mingguan*, *Ringkasan*, angkanya dari service yang sama dengan website. **CSV** berisi semua transaksi.
- Pulihkan backup: matikan aplikasi, salin file backup menjadi `data/dompetkos.db`, jalankan lagi.

## 11. Untuk developer

```bash
npm test           # 262 tes: parser, jatah, aturan potong, alur bot, keluarga, penjadwal, aturan kirim,
                   # undo, rekonsiliasi, kiriman, hutang-piutang, autopilot, skor, struk, ekspor, backup, OTP,
                   # asisten AI (runner CLI, kuota, status, usulan, memori, foto, review) — tanpa memanggil Claude asli
npm run typecheck
npm run db:seed    # isi ulang data awal (aman diulang)
npm run db:reset   # HAPUS semua data lalu seed ulang
```

```
prisma/schema.prisma          skema database (SQLite; bisa pindah ke Postgres)
src/lib/services/             service layer: SEMUA logika bisnis
src/lib/parser/               parser pesan santai (fungsi murni)
src/lib/allocation.ts         pembagian amplop + aturan potong (fungsi murni)
src/lib/delivery.ts           aturan jam tenang & jeda pesan (fungsi murni)
src/lib/bot/                  handler bot pemilik & keluarga
src/lib/whatsapp/             WhatsAppGateway, driver Baileys, manager (web ↔ bot)
src/app/                      website Next.js (App Router) + API /api/wa/*, /api/export/*, /api/backup
src/components/               UI: ikon SVG, grafik, form
src/lib/ocr/                  parser struk (fungsi murni) + mesin OCR lokal
src/lib/ai/                   asisten AI: runner `claude -p`, penjaga kuota/status, konteks data, prompt, aksi
bot/index.ts                  proses bot: WhatsApp, penjadwal tiap menit, pengirim antrean, backup, alarm kesehatan
.github/workflows/ci.yml      typecheck + tes + build di setiap PR
tests/                        vitest (database sementara, tidak menyentuh data asli)
```

Website dan bot tidak menghitung sendiri; keduanya memanggil service layer yang sama dan membaca database yang sama. Website ↔ bot berkomunikasi lewat tabel (`wa_command`, `outbox`), tanpa layanan pihak ketiga. Tidak ada analytics, iklan, atau layanan berbayar.

## 12. Asisten AI (Claude, pakai langganan)

Asisten memakai **Claude lewat Claude Code CLI** (`claude -p`) yang login dengan **token langganan Claude Pro/Max lo sendiri**. Tidak ada API key dan tidak ada tagihan per token; pemakaiannya masuk ke batas langganan yang sama dengan claude.ai. Fitur ini opsional: tanpa token, semua fitur lain jalan seperti biasa.

**Pasang (sekali):**

```bash
curl -fsSL https://claude.ai/install.sh | bash   # pasang Claude Code di server/laptop yang menjalankan DompetKos
claude setup-token                               # login di browser pakai akun Claude Pro, salin token yang muncul
```

Tempel token di website → **Koneksi → Claude** → *Simpan & tes*. Status berubah jadi **Aktif**.

**Server dipakai bareng orang lain?** Aman dari login/logout orang lain:

- Bot memakai token miliknya sendiri dan folder konfigurasi khusus (`data/claude-config`), jadi `claude` login/logout di terminal oleh siapa pun tidak berpengaruh, dan bot tidak pernah memakai akun orang lain.
- Proses `claude` dijalankan dengan lingkungan bersih: `ANTHROPIC_API_KEY` tidak pernah diteruskan, jadi tidak mungkin tertagih API.
- Semua tool Claude Code dimatikan (kecuali membaca foto yang dikirim), folder kerjanya di luar repo, dan data keuangan dikirim lewat stdin (tidak terlihat di `ps`).
- Token disimpan terenkripsi (kunci dari `SESSION_SECRET`) dan hanya ditampilkan 4 karakter terakhir. Tetap: jalankan DompetKos dengan user Linux sendiri dan `chmod 600 .env` / `chmod 700 data`. Siapa pun yang punya akses root tetap bisa membaca apa saja di server.
- Token ini untuk pemakaian pribadi lo. Jangan dibagikan atau dipakai melayani orang lain.

**Yang bisa dilakukan** (WhatsApp dan halaman **Asisten AI**):

| Contoh | Hasil |
| --- | --- |
| `berapa total jajan gw bulan september?` · `kapan terakhir beli galon?` | Dijawab dari data asli (angka dihitung sistem, bukan dikarang) |
| `boleh beli sepatu 150rb ga?` | Pertimbangan dengan tagihan, sisa amplop, target kado |
| `tadi geprek 15 sama es teh 5, kemarin bensin 10` | Dipecah jadi beberapa catatan → usulan → `ok` / `ok 1 3` / `batal` |
| `kenapa minggu ini boros?` | Penyebab dengan angka + usulan pindah uang |
| `rencanain makan seminggu budget 140rb` | Rencana menu + usulan masuk daftar belanja |
| `target kado gw aman?` | Status jalur + harus nyisihin berapa per minggu |
| `bantu bilang ke ayah butuh 100rb buat praktikum` | Draf pesan sopan → setelah `ok` dikirim ke nomor ortu |
| Foto struk / bukti transfer | Dibaca Claude (fallback OCR lokal); bukti transfer langsung ditawarkan sebagai kiriman |
| `ingat kado buat adik` · `memori` · `lupakan 2` · `reset obrolan` | Memori jangka panjang (juga bisa diedit di website) |

Kalimat yang dipahami perintah biasa tetap diproses instan tanpa AI (hemat kuota). Kata baru (mis. "seblak") ditebak amplopnya oleh AI dengan model ringan, lalu **dipelajari**: lain kali langsung dikenali tanpa AI. Rekap Sabtu mendapat evaluasi & satu tantangan minggu depan.

**AI cadangan (gratis, otomatis):** kalau Claude kena batas, tokennya ditolak, atau error, asisten pindah ke cadangan sesuai urutan (Koneksi → AI cadangan), dan balasannya diberi tanda "lewat Gemini/OpenRouter".

- **Gemini** lewat **Gemini CLI** resmi Google (`npm i -g @google/gemini-cli`). Sambungkan dengan salah satu: login akun Google sekali di folder bot (`HOME=$PWD/data/gemini-home NO_BROWSER=true gemini` → *Login with Google*), atau API key gratis dari Google AI Studio yang ditempel di website. Isolasinya sama dengan Claude: folder khusus bot, lingkungan proses bersih, hanya tool baca file (web, shell, tulis file dimatikan).
- **OpenRouter**: hanya model **gratis** (`:free`); model berbayar ditolak sebelum dikirim. Model dipilih dari daftar model gratis (diambil langsung dari OpenRouter) atau otomatis. Batas gratis sekitar 50 permintaan/hari.
- **Antigravity tidak dipakai**: aplikasi itu tidak punya cara resmi dipanggil dari aplikasi lain, dan alat tidak resmi yang "meminjam" kuotanya melanggar aturan Google (akun bisa diblokir). Gemini CLI memakai akun Google yang sama secara resmi.
- Privasi: di paket gratis, Google dan sebagian penyedia model gratis OpenRouter bisa memakai data yang dikirim untuk melatih model. Matikan cadangan kalau tidak mau.

**Aturan main:**

- AI **tidak bisa mengubah data sendiri**. Semua aksi (catat, pindah, daftar belanja, pesan ke ortu) hanya usulan, jalan setelah `ok`, tercatat di Aktivitas, dan bisa di-`batal`. Usulan divalidasi ulang di server (nominal wajar, amplop valid, tabungan kado tidak boleh diambil).
- Nomor keluarga **tidak pernah** dilayani AI.
- **Kalau Claude mati** (token kedaluwarsa/dicabut, kena batas langganan, Claude Code belum terpasang): bot tetap jalan normal, fitur AI istirahat, pemilik dikabari **sekali** lewat WhatsApp, dan bot mengecek ulang tiap 30 menit. Begitu pulih (token baru ditempel atau batas reset), AI nyala sendiri dan pemilik dikabari.
- **Batas langganan Claude (sesi 5 jam & mingguan)** dibaca dari `rate_limit_event` yang dikirim Claude Code (`--output-format stream-json`) setiap kali bot memanggil, lalu ditampilkan sebagai bar + jam reset di halaman Koneksi, peta, dan Asisten. Pemakaian lo di claude.ai ikut terhitung (angkanya diperbarui saat bot memanggil lagi; angka paling baru selalu di claude.ai → Settings → Usage). Kalau kena batas, AI istirahat **persis sampai jam reset**; kalau sesi 5 jam ≥90% (atau mingguan ≥95%), tugas kecil (tebak kategori, review) otomatis dihemat supaya sisa kuota buat lo.
- **Batas harian bot** (default 40 panggilan), pilihan model (utama & ringan), dan saklar tiap fitur ada di halaman Asisten. Pemakaian rinci (panggilan, token, waktu jawab, log) di halaman Koneksi.

## 13. Keamanan

**Yang sudah dijaga otomatis oleh aplikasi:**

- **Login**: password di-hash scrypt; sesi berupa cookie `httpOnly` bertanda tangan HMAC (otomatis `secure` di HTTPS), berlaku 30 hari. `SESSION_SECRET` di bawah 32 karakter ditolak.
- **Keluar dari semua perangkat** (Pengaturan → Keamanan): mencabut semua sesi seketika, misalnya kalau HP hilang.
- **Pembatasan percobaan**: 5 gagal per IP / 20 gagal total per 15 menit (password & kode WA). Kode WA 6 digit berlaku 5 menit, sekali pakai, hanya satu yang aktif, maks 5 per jam.
- **Kabar WhatsApp langsung** (tidak menunggu jam tenang) setiap ada login baru (jam, perangkat, IP) dan saat ada 5 percobaan login gagal. Riwayatnya di Pengaturan → Keamanan.
- **Semua halaman, API, dan server action wajib login** (dicek dua lapis: middleware + di setiap aksi). API yang mengubah data menolak permintaan dari situs lain (CSRF).
- **Header keamanan**: Content-Security-Policy (hanya aset dari server sendiri), anti-clickjacking, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS saat HTTPS, tanpa header `X-Powered-By`. API tidak pernah di-cache.
- **Izin file di server bersama**: saat web/bot mulai, `umask 077` dan `.env`, database, backup, sesi WhatsApp, serta konfigurasi Claude dirapatkan jadi hanya bisa dibaca user yang menjalankan aplikasi. Halaman Kesehatan sistem memberi tanda merah kalau ada yang masih terbuka.
- **Bot WhatsApp** hanya melayani nomor terdaftar; nomor keluarga tidak bisa mengubah data dan tidak pernah dilayani AI. Pesan dipotong maks 4.000 karakter.
- **Asisten AI**: token Claude dienkripsi; usulan AI divalidasi ulang di server dan baru jalan setelah `ok`; saat membaca foto, Claude hanya boleh membaca folder foto itu sendiri (izin lain otomatis ditolak); `ANTHROPIC_API_KEY` tidak pernah diteruskan.
- **Upload foto** dicek dari isi file (JPG/PNG/WEBP/GIF), maks 8 MB.
- **Dependency**: `npm audit` bersih (versi aman dipaksa lewat `overrides` di package.json). CI menjalankan typecheck, tes, dan build di setiap PR.

**Yang perlu lo lakukan di server:**

1. Jangan buka port 3000 langsung ke internet. Pakai **Cloudflare Tunnel** atau **Tailscale** (gratis) supaya otomatis HTTPS, lalu isi `WEB_HOST=127.0.0.1` dan `COOKIE_SECURE=1` di `.env`.
2. Pastikan `.env` dan `data/` hanya bisa dibaca lo: `chmod 600 .env && chmod -R go-rwx data` (aplikasi juga merapatkannya otomatis saat start).
3. Pakai password website yang panjang & unik (`npm run set-password <password>`), jangan sama dengan password lain.
4. Jalankan DompetKos dengan user Linux sendiri. Siapa pun yang punya akses **root/sudo** di server tetap bisa membaca semua file — itu batas yang tidak bisa ditutup aplikasi.
5. Simpan salinan backup (Pengaturan → Backup → Unduh) di luar server.
6. Repo GitHub sebaiknya **private**: README, contoh `.env`, dan tes memuat nomor WhatsApp pemilik & orang tua.

