"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";
import { Alert } from "./ui";

interface Status {
  status: "terhubung" | "terputus" | "menunggu_pairing";
  nomorBot: string | null;
  terhubungPada: string | null;
  terputusPada: string | null;
  alasan: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  botHidup: boolean;
  perintahMenunggu: number;
  nomorBotSamaDenganPenerima: boolean;
  riwayat: { id: number; peristiwa: string; alasan: string | null; waktu: string }[];
}

const LABEL = { terhubung: "Terhubung", terputus: "Terputus", menunggu_pairing: "Menunggu pairing" } as const;
const WARNA = { terhubung: "bg-ok-bg text-ok", terputus: "bg-bad-bg text-bad", menunggu_pairing: "bg-warn-bg text-warn" } as const;
const PERISTIWA: Record<string, string> = { terhubung: "Terhubung", terputus: "Terputus", logout: "Diputuskan", pairing: "Menunggu pairing" };

function wib(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, ":") + " WIB";
}

export default function WaPanel() {
  const [s, setS] = useState<Status | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [mode, setMode] = useState<"qr" | "code" | null>(null);
  const [phone, setPhone] = useState("");
  const [konfirmasiPutus, setKonfirmasiPutus] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    try {
      const r = await fetch("/api/wa/status", { cache: "no-store" });
      if (r.status === 401) return void (window.location.href = "/login");
      setS(await r.json());
    } catch {
      /* jaringan putus sebentar: coba lagi di polling berikutnya */
    }
  }, []);

  useEffect(() => {
    void muat();
    const id = setInterval(() => void muat(), 2000);
    return () => clearInterval(id);
  }, [muat]);

  async function kirim(url: string, body?: object) {
    setSibuk(true);
    setGalat(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json();
      if (!r.ok) setGalat(j.error ?? "Gagal");
      await muat();
    } finally {
      setSibuk(false);
    }
  }

  if (!s) return <p className="text-muted">Memuat status…</p>;

  return (
    <div className="space-y-4">
      {!s.botHidup && (
        <Alert tone="bad">
          Proses bot belum berjalan, jadi tombol di bawah belum direspons. Jalankan <code>npm run dev</code> atau <code>npm start</code>.
        </Alert>
      )}
      {s.nomorBotSamaDenganPenerima && (
        <Alert tone="warn">Nomor bot sama dengan salah satu nomor penerima. Pakai nomor cadangan supaya nomor utama aman kalau diblokir WhatsApp.</Alert>
      )}

      <section className="card card-pad space-y-3" aria-live="polite">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="message" size={18} className="text-muted" />
            Status koneksi
          </h2>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${WARNA[s.status]}`}>
            <span className={`size-2 rounded-full bg-current ${s.status === "menunggu_pairing" ? "animate-pulse" : ""}`} />
            {LABEL[s.status]}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Nomor bot</dt>
          <dd>{s.nomorBot ? `+${s.nomorBot}` : "—"}</dd>
          <dt className="text-muted">Terakhir terhubung</dt>
          <dd>{wib(s.terhubungPada)}</dd>
          {s.status !== "terhubung" && (
            <>
              <dt className="text-muted">Alasan</dt>
              <dd>{s.alasan ?? "—"}</dd>
            </>
          )}
        </dl>
      </section>

      {s.status === "menunggu_pairing" && (s.qrDataUrl || s.pairingCode) && (
        <section className="card card-pad space-y-3 text-center">
          {s.qrDataUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.qrDataUrl} alt="QR code pairing WhatsApp" width={288} height={288} className="mx-auto rounded-xl bg-white p-2" />
              <p className="text-sm text-muted">Di HP bot: WhatsApp → Perangkat tertaut → Tautkan perangkat → scan QR ini. QR diperbarui otomatis.</p>
            </>
          )}
          {s.pairingCode && (
            <>
              <p className="text-4xl font-bold tracking-widest">{s.pairingCode}</p>
              <p className="text-sm text-muted">Di HP bot: WhatsApp → Perangkat tertaut → Tautkan perangkat → “Tautkan dengan nomor telepon”, lalu ketik kode ini.</p>
            </>
          )}
        </section>
      )}
      {s.status === "menunggu_pairing" && !s.qrDataUrl && !s.pairingCode && <p className="card card-pad flex items-center justify-center gap-2 text-sm text-muted"><Icon name="refresh" size={16} className="animate-spin" />Menyiapkan QR / kode… (maks. 30 detik)</p>}

      {s.status !== "terhubung" && (
        <section className="card card-pad space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="link" size={18} className="text-muted" />
            Hubungkan
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button className="btn flex-1" disabled={sibuk} onClick={() => { setMode("qr"); void kirim("/api/wa/connect", { mode: "qr" }); }}>
              <Icon name="qr" size={18} />
              Hubungkan lewat QR
            </button>
            <button className="btn-secondary flex-1" onClick={() => setMode(mode === "code" ? null : "code")}>
              <Icon name="key" size={18} />
              Pakai kode pairing
            </button>
          </div>
          {mode === "code" && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void kirim("/api/wa/connect", { mode: "code", phone });
              }}
            >
              <label htmlFor="phone" className="label">
                Nomor bot (nomor cadangan)
              </label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="0812xxxxxxxx" className="input" required />
              <button className="btn w-full" disabled={sibuk}>
                Minta kode pairing
              </button>
            </form>
          )}
        </section>
      )}

      {s.status === "terhubung" && (
        <section className="card card-pad space-y-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <Icon name="link-off" size={18} className="text-muted" />
            Putuskan
          </h2>
          <p className="text-sm text-muted">Sesi di server dihapus dan perangkat tertaut dilepas dari WhatsApp. Buat nyambung lagi harus pairing ulang.</p>
          {!konfirmasiPutus ? (
            <button className="btn-danger w-full" onClick={() => setKonfirmasiPutus(true)}>
              <Icon name="link-off" size={17} />
              Putuskan
            </button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-danger flex-1" disabled={sibuk} onClick={async () => { await kirim("/api/wa/logout"); setKonfirmasiPutus(false); }}>
                Ya, putuskan
              </button>
              <button className="btn-secondary" onClick={() => setKonfirmasiPutus(false)}>
                Batal
              </button>
            </div>
          )}
        </section>
      )}

      {galat && <Alert tone="bad">{galat}</Alert>}

      <section className="card card-pad">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Icon name="clock" size={18} className="text-muted" />
          Riwayat koneksi
        </h2>
        {s.riwayat.length === 0 ? (
          <p className="text-sm text-muted">Belum ada.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {s.riwayat.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 py-1.5">
                <span>
                  <b>{PERISTIWA[l.peristiwa] ?? l.peristiwa}</b>
                  {l.alasan && <span className="text-muted"> — {l.alasan}</span>}
                </span>
                <span className="shrink-0 text-muted">{wib(l.waktu)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
