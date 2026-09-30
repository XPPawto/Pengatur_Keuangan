# DompetKos

Website + bot WhatsApp untuk mengatur uang mingguan Rp300.000 dengan **sistem amplop**: Makan, Paket data, Paylater, Tabungan kado, dan Darurat & kos.
Catat dari WhatsApp (`tempe 5k`), langsung dibalas sisa uang dan jatah makan hari ini. Website untuk gambaran besar, anggaran, tagihan, target, belanja, dan rekap.

Semua fase PRD (1–3) sudah dikerjakan, ditambah beberapa fitur ekstra (laporan untuk orang tua, login kode WhatsApp, catat mundur, ubah catatan, PWA, data demo).

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

---

## 1. Fitur

**Website** (mobile-first, mode gelap mengikuti HP, ikon SVG, bisa dipasang ke layar utama HP sebagai aplikasi)

| Halaman | Isi |
| --- | --- |
| Beranda | Jatah makan hari ini (angka besar + status), streak, progres kado, dana darurat, uang diselamatkan, saldo semua amplop, tagihan terdekat dengan hitung mundur, transaksi hari ini |
| Catat | Form cepat (format nominal sama dengan bot), pilih amplop, tanggal (bisa catat mundur dalam periode), tombol cepat item belanja, tandai "tidak jajan" |
| Riwayat | Transaksi per periode, filter amplop, cari catatan, ubah/hapus, sumber WA/Web, pesan WA asli, daftar pindah amplop, unduh CSV |
| Amplop & anggaran | Saldo, pindah antar amplop (wajib alasan), koreksi alokasi periode, nominal default, urutan potong, kunci/buka kunci, tabel rencana per minggu (bisa diubah) |
| Tagihan | Tagihan belum lunas + kesiapan dana (cukup/kurang), tandai lunas (dicatat dari amplop sumber), ubah/hapus, tambah tagihan, riwayat lunas |
| Target | Tabungan kado: terkumpul, proyeksi saat tenggat, perkiraan tanggal tembus minimal, grafik kumulatif aktual vs rencana, ubah target |
| Belanja mingguan | Daftar belanja dengan harga yang bisa diedit, total vs budget (aman/lewat), centang saat belanja, lauk rotasi 4 minggu, menu 7 hari tanpa sayur (bisa diedit) |
| Rekap | Grafik pengeluaran per amplop per minggu, makan per hari vs jatah, disiplin mencatat, uang diselamatkan, mode tahan belanja |
| Koneksi WhatsApp | Status real-time, pairing lewat QR atau kode, putuskan, riwayat koneksi |
| Pengaturan | Nomor penerima & perannya, jadwal pengingat, nama, batas tahan belanja, login kode WA, ekspor Excel/CSV, backup & unduh backup, antrean pesan otomatis |

Semua grafik punya tooltip saat disentuh dan tampilan tabel. Transaksi dari WhatsApp muncul di website dalam ±4 detik tanpa refresh.

**Bot WhatsApp**: catat bebas format, tanya balik kalau kategori tidak jelas, jatah harian otomatis, pindah amplop, bayar tagihan, tahan belanja, rekap, target, daftar belanja & menu, pengingat terjadwal, laporan sopan untuk orang tua.

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

Di HP Android bekas (Termux): `pkg install nodejs git`, langkah sama, lalu `termux-wake-lock`.
Buka dari HP di Wi-Fi yang sama: `http://<ip-laptop>:3000`, lalu "Tambahkan ke layar utama" supaya terasa seperti aplikasi.

**Mau lihat dulu tanpa data asli?** Isi database demo 4 minggu:

```bash
DATABASE_URL="file:../data/demo.db" npm run demo
DATABASE_URL="file:../data/demo.db" npm run dev
```

## 5. Menyambungkan WhatsApp (dari website)

1. Jalankan web + bot. Kalau bot mati atau WhatsApp terputus, semua halaman menampilkan banner merah.
2. Login → menu **Koneksi WhatsApp**.
3. **Hubungkan lewat QR**: di HP bot buka WhatsApp → *Perangkat tertaut* → *Tautkan perangkat* → scan. QR diperbarui otomatis.
   Atau **Pakai kode pairing**: isi nomor bot, ketik kode 8 huruf di *Tautkan dengan nomor telepon*.
4. Status berubah jadi **Terhubung** tanpa refresh. Kirim `bantuan` dari nomor pemilik.
5. **Putuskan** melepas perangkat tertaut dan menghapus sesi di server.

> Bot memakai [Baileys](https://github.com/WhiskeySockets/Baileys) (tidak resmi). Gratis dan bebas kirim pengingat, tapi nomor bot **bisa diblokir kapan saja** — karena itu wajib nomor cadangan. Koneksi dibungkus interface `WhatsAppGateway`, jadi bisa pindah ke WhatsApp Cloud API resmi tanpa mengubah logika.

## 6. Perintah bot

| Pesan | Hasil |
| --- | --- |
| `tempe 5k` · `beli telur 14rb` | Catat ke amplop yang ditebak dari kata kunci, balas sisa + jatah |
| `tempe 5k sama telur 14k` | Banyak catatan sekaligus (pemisah: `sama`, `dan`, `,`, `+`, baris baru) |
| `kemarin tempe 5k` | Catat untuk kemarin |
| `ojek 10k` | Kategori tidak jelas → bot tanya pilihan bernomor |
| `batal` | Hapus catatan terakhir (dengan konfirmasi) |
| `ubah 12k` | Ganti nominal catatan terakhir |
| `nol` · `gak jajan` | Tandai hari ini tanpa jajan (streak tetap jalan) |
| `sisa` · `jatah` · `hari ini` | Saldo semua amplop · jatah makan · transaksi hari ini |
| `rekap` | Ringkasan minggu ini |
| `target` | Progres tabungan kado + proyeksi |
| `tagihan` | Tagihan belum lunas + kesiapan dana |
| `masuk 300` · `gajian 300rb` | Uang mingguan masuk → usulan pembagian → balas `ok` |
| `masuk 40` (minggu yang sama) | Uang ekstra, default 50% kado / 50% darurat, atau pilih amplop |
| `bayar paylater 50k` | Bayar dari amplop Paylater & tandai lunas (nominal beda = tagihan disesuaikan) |
| `pindah 10k darurat ke makan alasan ...` | Pindah antar amplop; tanpa alasan → bot tanya; dari Tabungan kado wajib `YAKIN AMBIL TABUNGAN` |
| `mau beli headset 60k` | Mode tahan belanja: dampak ke jatah & tabungan, lalu 1) tunda 24 jam, 2) beli sekarang, 3) gak jadi |
| `beli` · `gak jadi` | Jawaban setelah bot menanyakan ulang pembelian yang ditahan |
| `belanja` · `menu` | Daftar belanja minggu ini · menu hari ini + lauk rotasi |
| `bantuan` | Daftar perintah |

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

Semua bisa dinyalakan/dimatikan per nomor di **Pengaturan → Nomor WhatsApp**, termasuk menambah anggota keluarga lain.

## 8. Pengingat otomatis

| Waktu (WIB) | Isi | Penerima |
| --- | --- | --- |
| Minggu 09.00, ulang tiap 3 jam s.d. 21.00 | "Uang udah masuk?" — berhenti setelah dikonfirmasi | Pemilik |
| Setiap hari 07.00 | Jatah makan, menu hari ini, tagihan 3 hari ke depan | Pemilik |
| Setiap hari 21.00 | "Udah catat?" — hanya kalau belum ada catatan | Pemilik |
| H-3 & H-1 jatuh tempo, 09.00 | Tagihan: nominal, saldo amplop, cukup/kurang | Pemilik |
| Sabtu 20.00 | Rekap mingguan | Pemilik |
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

## 10. Backup & ekspor

- **Backup otomatis** tiap Sabtu 23.30 ke `data/backups/`, simpan 4 terakhir (salinan konsisten via `VACUUM INTO`). Bisa juga **Backup sekarang** dan **unduh** file backup dari Pengaturan — simpan salinannya di luar laptop.
- **Ekspor Excel** (Pengaturan / Rekap): sheet *Belanja Makan*, *Budget Mingguan*, *Ringkasan*, angkanya dari service yang sama dengan website. **CSV** berisi semua transaksi.
- Pulihkan backup: matikan aplikasi, salin file backup menjadi `data/dompetkos.db`, jalankan lagi.

## 11. Untuk developer

```bash
npm test           # 178 tes: parser (30+ pesan santai), jatah, aturan potong, alur bot, keluarga,
                   # penjadwal, aturan kirim, ekspor Excel, backup, OTP, koneksi WhatsApp
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
bot/index.ts                  proses bot: WhatsApp, penjadwal tiap menit, pengirim antrean, backup
tests/                        vitest (database sementara, tidak menyentuh data asli)
```

Website dan bot tidak menghitung sendiri; keduanya memanggil service layer yang sama dan membaca database yang sama. Website ↔ bot berkomunikasi lewat tabel (`wa_command`, `outbox`), tanpa layanan pihak ketiga. Tidak ada analytics, iklan, atau layanan berbayar.
