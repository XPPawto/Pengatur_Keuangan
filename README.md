# DompetKos

Website + bot WhatsApp buat ngatur uang mingguan Rp300.000 pakai **sistem amplop**: Makan, Paket data, Paylater, Tabungan kado, dan Darurat & kos.
Catat dari WhatsApp (`tempe 5k`), langsung dibalas sisa uang & jatah makan hari ini. Website buat lihat gambaran besar.

> Status: **Fase 1 (MVP)** selesai. Fase 2 (tagihan, target, pengingat) dan Fase 3 (tahan belanja, rekap, ekspor) belum.

---

## 1. Yang dibutuhkan

- Node.js 20 atau lebih baru (`node -v`)
- Laptop/PC yang sering nyala, HP Android bekas (Termux), atau VPS gratis — bot harus jalan terus
- **Nomor WhatsApp cadangan** untuk bot. Jangan pakai nomor utama dan jangan pakai 085163544535 / 08971688893 (lihat [Risiko](#6-risiko-whatsapp))

## 2. Install

```bash
git clone <repo-ini> dompetkos
cd dompetkos
npm install
npm run setup
```

`npm run setup` akan:

1. membuat file `.env` dari `.env.example`, lengkap dengan `SESSION_SECRET` acak dan **password login awal acak** (dicetak sekali di layar, catat!),
2. membuat database SQLite di `data/dompetkos.db`,
3. mengisi data awal: 5 amplop, rencana pembagian 4 Okt–29 Nov 2026, tagihan paylater, target kado Rp800–900rb, daftar belanja.

Ganti password kapan saja:

```bash
npm run set-password passwordBaruMinimal8
# salin baris APP_PASSWORD_HASH=... yang keluar ke .env, lalu restart
```

## 3. Isi `.env`

| Variabel | Isi |
| --- | --- |
| `DATABASE_URL` | Lokasi database. Default `file:../data/dompetkos.db` (relatif ke folder `prisma/`) |
| `OWNER_WA_NUMBERS` | Nomor yang boleh ngobrol dengan bot, format internasional, pisah koma. Default `6285163544535,628971688893` |
| `APP_PASSWORD_HASH` | Hash password login website (buat dengan `npm run set-password`) |
| `SESSION_SECRET` | Kunci acak untuk cookie login |
| `WA_SESSION_DIR` | Folder sesi WhatsApp. Default `./data/wa-session` |
| `COOKIE_SECURE` | Isi `1` kalau website dibuka lewat HTTPS. Kosongkan untuk `http://localhost` / jaringan lokal |

`.env`, `data/` (database + sesi WhatsApp) sudah dikecualikan dari git. Jangan pernah upload.

## 4. Menjalankan

```bash
npm run dev        # web (http://localhost:3000) + bot sekaligus, untuk development
```

Untuk dipakai harian (lebih ringan):

```bash
npm run build
npm start          # web + bot, mode produksi
```

Mau jalan sendiri-sendiri: `npm run start:web` dan `npm run start:bot`.

Supaya tetap hidup setelah terminal ditutup / laptop restart, pakai `pm2` (gratis):

```bash
npm i -g pm2
pm2 start npm --name dompetkos -- start
pm2 save && pm2 startup
```

Di HP Android (Termux): `pkg install nodejs git`, lalu langkah yang sama. Aktifkan `termux-wake-lock` supaya tidak dimatikan Android.

Buka website dari HP di Wi-Fi yang sama: `http://<ip-laptop>:3000`.

## 5. Menyambungkan WhatsApp (dari website)

1. Pastikan bot jalan (`npm run dev` atau `npm start`). Kalau bot mati, website menampilkan banner merah.
2. Login ke website → menu **WhatsApp**.
3. Pilih salah satu:
   - **Hubungkan lewat QR**: QR muncul di layar (diperbarui otomatis). Di HP bot: WhatsApp → *Perangkat tertaut* → *Tautkan perangkat* → scan.
   - **Pakai kode pairing**: masukkan nomor bot, website menampilkan kode 8 huruf. Di HP bot: *Perangkat tertaut* → *Tautkan perangkat* → *Tautkan dengan nomor telepon* → ketik kodenya. Cocok kalau QR susah di-scan dari HP yang sama.
4. Status berubah jadi **Terhubung** tanpa perlu refresh.
5. Kirim `bantuan` dari salah satu nomor terdaftar ke nomor bot.

**Putuskan**: tombol *Putuskan* di halaman yang sama melepas perangkat tertaut dari WhatsApp dan menghapus sesi di server. Riwayat terhubung/terputus ada di bawahnya.

Pesan dari nomor selain `OWNER_WA_NUMBERS` diabaikan tanpa balasan (tetap dicatat di log).

## 6. Risiko WhatsApp

Bot memakai [Baileys](https://github.com/WhiskeySockets/Baileys) (library **tidak resmi**, perangkat tertaut). Gratis dan bebas kirim pengingat, tapi melanggar ketentuan WhatsApp dan nomornya **bisa diblokir kapan saja**. Karena itu wajib nomor cadangan. Koneksi dibungkus interface `WhatsAppGateway` (`src/lib/whatsapp/gateway.ts`), jadi nanti bisa pindah ke WhatsApp Cloud API resmi tanpa mengubah logika.

## 7. Cara pakai bot

| Pesan | Hasil |
| --- | --- |
| `tempe 5k` / `beli telur 14rb` | Catat ke amplop Makan, balas sisa + jatah hari ini |
| `tempe 5k sama telur 14k` | 2 catatan sekaligus (pemisah: `sama`, `dan`, `,`, `+`, baris baru) |
| `ojek 10k` | Kategori nggak jelas → bot tanya pilihan bernomor |
| `masuk 300` / `gajian 300rb` | Mulai periode baru, tampilkan usulan pembagian, balas `ok` |
| `masuk 40` (di minggu yang sama) | Uang ekstra, default 50% kado / 50% darurat |
| `sisa` | Ringkasan semua amplop + jatah makan |
| `hari ini` | Transaksi hari ini |
| `batal` | Hapus transaksi terakhir (pakai konfirmasi) |
| `nol` / `gak jajan` | Tandai hari ini tanpa jajan (tetap dihitung disiplin) |
| `bantuan` | Daftar perintah |

Nominal yang dimengerti: `12k`, `12rb`, `12 ribu`, `12.000`, `12000`, `1,5jt`, `rp5.000`. Angka polos di bawah 1000 dianggap ribuan (`masuk 300` = Rp300.000, `tempe 5` = Rp5.000, bot kasih catatan).

Coba tanpa WhatsApp (menulis ke database yang sama):

```bash
npm run wa:sim -- 085163544535 "tempe 5k sama telur 14k"
```

### Aturan hitung

- **Jatah makan hari ini** = (sisa amplop Makan + yang sudah dipakai hari ini) ÷ sisa hari periode (termasuk hari ini), dibulatkan ke bawah ke ratusan. Angkanya tetap sepanjang hari; kalau lewat, bot kasih tahu **jatah besok** yang baru (sisa ÷ sisa hari setelah hari ini). Contoh: sisa Rp61.000, 6 hari → Rp10.100.
- **Periode** = Minggu–Sabtu, dimulai saat uang masuk dikonfirmasi. Saat periode baru dikonfirmasi, sisa Makan minggu lalu otomatis pindah ke Darurat.
- **Uang kurang dari rencana**: potong Darurat dulu, lalu Tabungan kado, lalu Paylater (hanya kalau tagihan berikutnya > 14 hari lagi). Makan dan Data tidak pernah dipotong otomatis.
- **Saldo** tidak disimpan, selalu dihitung dari alokasi − pengeluaran ± pindahan. Makan & Data per minggu; Paylater, Tabungan kado, dan Darurat menumpuk lintas minggu.
- **Tabungan kado terkunci**: ambil dari situ harus ketik `YAKIN AMBIL TABUNGAN`.

## 8. Backup

Semua data ada di satu file: `data/dompetkos.db`. Backup manual:

```bash
cp data/dompetkos.db "backup-$(date +%F).db"
```

(Backup otomatis tiap Sabtu malam, simpan 4 terakhir, masuk Fase 3.)

## 9. Untuk developer

```bash
npm test           # unit + integrasi (parser, jatah, aturan potong, alur bot, koneksi WA)
npm run typecheck
npm run db:seed    # isi ulang data awal (aman diulang)
npm run db:reset   # HAPUS semua data lalu seed ulang
```

Struktur:

```
prisma/schema.prisma        skema database (SQLite)
src/lib/services/           service layer: SEMUA logika bisnis (periode, amplop, transaksi, jatah)
src/lib/parser/             parser pesan santai (fungsi murni)
src/lib/allocation.ts       pembagian amplop + aturan potong (fungsi murni)
src/lib/bot/                handler bot: pesan masuk → balasan
src/lib/whatsapp/           WhatsAppGateway, driver Baileys, manager (perintah web ↔ bot)
src/app/                    website Next.js (Beranda, Catat, Riwayat, WhatsApp, API /api/wa/*)
bot/index.ts                proses bot worker
tests/                      vitest
```

Website dan bot tidak menghitung sendiri; keduanya memanggil service layer yang sama dan membaca database yang sama.
Website memperbarui data tiap 4–5 detik, jadi catatan dari WhatsApp muncul tanpa refresh.
