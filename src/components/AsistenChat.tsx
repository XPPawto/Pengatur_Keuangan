"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { jalankanAksiAction, resetObrolanAction, tanyaAsistenAction } from "@/app/actions-ai";
import type { AksiAI } from "@/lib/ai/asisten";
import type { KodePenyedia, OpsiPenyedia } from "@/lib/ai/model";
import { rp } from "@/lib/money";
import { Icon, type IconName } from "./icons";
import { LogoPenyedia } from "./LogoAI";

interface Pesan {
  peran: "user" | "asisten" | "sistem";
  isi: string;
  aksi?: AksiAI[];
  memori?: string[];
  gagal?: boolean;
  penyedia?: string;
  model?: string;
  /** penyedia dipilih eksplisit (bukan otomatis + cadangan) */
  dipilih?: boolean;
}

const NAMA_PENYEDIA: Record<string, string> = { claude: "Claude", gemini: "Gemini", openrouter: "OpenRouter" };
const KUNCI_PILIHAN = "dk-ai-pilihan";

const NAMA: Record<string, string> = { makan: "Makan", data: "Paket data", paylater: "Paylater", kado: "Tabungan kado", darurat: "Darurat & kos" };

const CONTOH: { ikon: IconName; teks: string }[] = [
  { ikon: "trending-up", teks: "Kenapa minggu ini boros?" },
  { ikon: "cart", teks: "Boleh beli sepatu 150rb minggu ini?" },
  { ikon: "utensils", teks: "Rencanain makan seminggu sesuai budget makan gw, sekalian daftar belanjanya" },
  { ikon: "gift", teks: "Target kado gw masih aman? Harus nyisihin berapa per minggu?" },
  { ikon: "receipt", teks: "Berapa total jajan gw bulan ini dibanding bulan lalu?" },
  { ikon: "message", teks: "Bantu tulis pesan terima kasih ke Ayah buat kiriman terakhir" },
];

function ringkas(a: AksiAI): { ikon: IconName; teks: string } {
  switch (a.jenis) {
    case "catat":
      return { ikon: "plus-circle", teks: `Catat ${a.catatan} ${rp(a.nominal)} → ${NAMA[a.amplop]}${a.tanggal ? ` (${a.tanggal})` : ""}` };
    case "pindah":
      return { ikon: "transfer", teks: `Pindah ${rp(a.nominal)} ${NAMA[a.dari]} → ${NAMA[a.ke]} (${a.alasan})` };
    case "belanja":
      return { ikon: "cart", teks: `Daftar belanja: ${a.nama} ${a.jumlah} ${a.satuan} @${rp(a.harga)}` };
    case "kata":
      return { ikon: "brain", teks: `Ingat kata "${a.kata}" = ${NAMA[a.amplop]}` };
    case "pesan_keluarga":
      return { ikon: "send", teks: "Kirim pesan di atas ke orang tua lewat WhatsApp" };
  }
}

/** Format gaya WhatsApp: *tebal*, baris baru, daftar "• ". */
function TeksWA({ teks }: { teks: string }) {
  return (
    <>
      {teks.split("\n").map((baris, i) => {
        const bagian: ReactNode[] = baris.split(/(\*[^*\n]+\*)/g).map((b, j) =>
          /^\*[^*]+\*$/.test(b) ? <strong key={j}>{b.slice(1, -1)}</strong> : <Fragment key={j}>{b.replace(/`([^`]+)`/g, "$1")}</Fragment>,
        );
        return baris.trim() === "" ? <span key={i} className="block h-2" /> : <span key={i} className="block">{bagian}</span>;
      })}
    </>
  );
}

export default function AsistenChat({ riwayat, siap, pesanMati, opsi }: { riwayat: Pesan[]; siap: boolean; pesanMati: string | null; opsi: OpsiPenyedia[] }) {
  const [pesan, setPesan] = useState<Pesan[]>(riwayat);
  const [input, setInput] = useState("");
  const [mikir, startMikir] = useTransition();
  const [jalan, startJalan] = useTransition();
  const [pilihan, setPilihan] = useState<boolean[]>([]);
  // pilihan penyedia & model untuk pesan berikutnya ("" = otomatis: Claude dulu, cadangan kalau Claude nggak bisa)
  const [penyedia, setPenyedia] = useState<"" | KodePenyedia>("");
  const [model, setModel] = useState("");
  const dipilih = opsi.find((o) => o.kode === penyedia) ?? null;
  // kalau penyedia dipilih eksplisit, kotak chat tetap aktif walau mode otomatis lagi tidak siap
  const bisa = siap || !!dipilih;
  const akhir = useRef<HTMLDivElement>(null);
  const usulan = pesan.length && pesan[pesan.length - 1].aksi?.length ? pesan[pesan.length - 1].aksi! : null;

  useEffect(() => {
    akhir.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [pesan, mikir]);

  // ingat pilihan terakhir di browser ini (kenyamanan saja; kalau penyimpanan diblokir, tetap jalan)
  useEffect(() => {
    try {
      const j = JSON.parse(localStorage.getItem(KUNCI_PILIHAN) ?? "null") as { p?: string; m?: string } | null;
      const o = opsi.find((x) => x.kode === j?.p);
      if (o) {
        setPenyedia(o.kode);
        setModel(o.model.some((m) => m.v === j?.m) ? (j?.m ?? "") : "");
      }
    } catch {
      /* abaikan */
    }
  }, [opsi]);
  const simpanPilihan = (p: "" | KodePenyedia, m: string) => {
    setPenyedia(p);
    setModel(m);
    try {
      localStorage.setItem(KUNCI_PILIHAN, JSON.stringify({ p, m }));
    } catch {
      /* abaikan */
    }
  };

  const kirim = (teks: string) => {
    const t = teks.trim();
    if (!t || mikir) return;
    setInput("");
    setPesan((p) => [...p, { peran: "user", isi: t }]);
    startMikir(async () => {
      try {
        const r = await tanyaAsistenAction(t, penyedia ? { penyedia, model: model || undefined } : undefined);
        setPesan((p) => [...p, { peran: "asisten", isi: r.balasan, aksi: r.aksi, memori: r.memori, gagal: !r.ok, penyedia: r.penyedia, model: r.model, dipilih: r.dipilih }]);
        setPilihan(r.aksi.map(() => true));
      } catch {
        setPesan((p) => [...p, { peran: "asisten", isi: "Gagal menghubungi server. Coba lagi.", gagal: true }]);
      }
    });
  };

  const jalankan = () => {
    if (!usulan) return;
    const dipilih = usulan.filter((_, i) => pilihan[i]);
    if (!dipilih.length) return;
    startJalan(async () => {
      const r = await jalankanAksiAction(dipilih);
      const baris = [...(r.berhasil.length ? ["*Beres:*", ...r.berhasil.map((b) => `• ${b}`)] : []), ...(r.gagal.length ? ["*Nggak bisa dijalankan:*", ...r.gagal.map((g) => `• ${g}`)] : [])];
      if (r.berhasil.length) baris.push("", "Salah? Batalkan dari menu Aktivitas.");
      setPesan((p) => [...p.slice(0, -1), { ...p[p.length - 1], aksi: undefined }, { peran: "sistem", isi: baris.join("\n"), gagal: !r.berhasil.length }]);
    });
  };

  const buang = () => setPesan((p) => [...p.slice(0, -1), { ...p[p.length - 1], aksi: undefined }, { peran: "sistem", isi: "Usulan dibuang." }]);

  return (
    <div className="flex min-h-[520px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pb-3" aria-live="polite">
        {pesan.length === 0 && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted">Tanya apa aja soal duit lo. Asisten baca saldo amplop, tagihan, target kado, dan riwayat transaksi lo (data dihitung sistem, bukan dikarang AI).</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CONTOH.map((c) => (
                <button key={c.teks} type="button" onClick={() => kirim(c.teks)} disabled={!bisa || mikir} className="flex items-start gap-2 rounded-xl border border-line bg-card p-3 text-left text-sm hover:border-line-strong disabled:opacity-50">
                  <Icon name={c.ikon} size={17} className="mt-px shrink-0 text-brand" />
                  {c.teks}
                </button>
              ))}
            </div>
          </div>
        )}
        {pesan.map((m, i) =>
          m.peran === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-brand-fg">{m.isi}</p>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${m.peran === "sistem" ? "bg-subtle text-muted" : m.gagal ? "bg-warn-bg text-warn" : "bg-brand-soft text-brand"}`}>
                <Icon name={m.peran === "sistem" ? (m.gagal ? "alert" : "check") : "bot"} size={16} />
              </span>
              <div className="min-w-0 max-w-[85%] space-y-2">
                <div className={`rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed ${m.gagal ? "bg-warn-bg text-warn" : "bg-subtle"}`}>
                  <TeksWA teks={m.isi} />
                </div>
                {m.penyedia && (m.dipilih || m.penyedia !== "claude") && !m.gagal && (
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    {m.penyedia === "claude" || m.penyedia === "gemini" || m.penyedia === "openrouter" ? <LogoPenyedia penyedia={m.penyedia} size={13} /> : <Icon name="transfer" size={13} />}
                    Dijawab lewat {NAMA_PENYEDIA[m.penyedia] ?? m.penyedia}
                    {m.model ? ` · ${m.model}` : ""}
                    {m.dipilih ? "" : " (cadangan)"}
                  </p>
                )}
                {m.memori?.map((x) => (
                  <p key={x} className="flex items-center gap-1.5 text-xs text-muted">
                    <Icon name="brain" size={13} />
                    {x}
                  </p>
                ))}
                {m.aksi && m.aksi.length > 0 && i === pesan.length - 1 && (
                  <div className="space-y-2 rounded-xl border border-line bg-card p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Usulan, jalan setelah lo setujui</p>
                    <ul className="space-y-1.5">
                      {m.aksi.map((a, j) => {
                        const r = ringkas(a);
                        return (
                          <li key={j}>
                            <label className="flex cursor-pointer items-start gap-2 text-sm">
                              <input type="checkbox" checked={pilihan[j] ?? true} onChange={(e) => setPilihan((p) => m.aksi!.map((_, k) => (k === j ? e.target.checked : (p[k] ?? true))))} className="mt-0.5 size-4 accent-[var(--brand)]" />
                              <Icon name={r.ikon} size={16} className="mt-0.5 shrink-0 text-muted" />
                              <span>{r.teks}</span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" onClick={jalankan} disabled={jalan || !pilihan.some(Boolean)} className="btn btn-sm">
                        <Icon name="check" size={15} />
                        {jalan ? "Menjalankan…" : `Jalankan ${pilihan.filter(Boolean).length || ""}`}
                      </button>
                      <button type="button" onClick={buang} disabled={jalan} className="btn-ghost btn-sm">
                        Buang
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {mikir && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Icon name="bot" size={16} />
            </span>
            <Icon name="refresh" size={15} className="animate-spin" />
            Asisten lagi mikir… (bisa sampai 30 detik)
          </div>
        )}
        <div ref={akhir} />
      </div>

      {!bisa && pesanMati && (
        <p className="mb-2 flex items-start gap-2 rounded-xl bg-warn-bg px-3 py-2 text-sm text-warn">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {pesanMati}
        </p>
      )}
      {opsi.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
          <label htmlFor="pilih-penyedia" className="text-muted">
            Dijawab oleh
          </label>
          <select id="pilih-penyedia" value={penyedia} onChange={(e) => simpanPilihan(e.target.value as "" | KodePenyedia, "")} className="input !min-h-9 !w-auto !py-1">
            <option value="">Otomatis (Claude dulu, cadangan kalau error)</option>
            {opsi.map((o) => (
              <option key={o.kode} value={o.kode}>
                {o.label}
              </option>
            ))}
          </select>
          {dipilih && (
            <>
              <label htmlFor="pilih-model" className="sr-only">
                Model
              </label>
              <select id="pilih-model" value={model} onChange={(e) => simpanPilihan(penyedia, e.target.value)} className="input !min-h-9 !w-auto max-w-full !py-1">
                <option value="">Model bawaan ({dipilih.modelDefault})</option>
                {dipilih.model.map((m) => (
                  <option key={m.v} value={m.v}>
                    {m.l}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          kirim(input);
        }}
        className="flex items-end gap-2 border-t border-line pt-3"
      >
        <label htmlFor="tanya" className="sr-only">
          Pesan untuk asisten
        </label>
        <textarea
          id="tanya"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              kirim(input);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={bisa ? "Tanya atau cerita apa aja…" : "Asisten belum aktif"}
          disabled={!bisa}
          className="input max-h-40 min-h-11 flex-1 resize-y"
        />
        <button className="btn min-h-11 !px-3" disabled={!bisa || mikir || !input.trim()} aria-label="Kirim">
          <Icon name="send" size={18} />
        </button>
      </form>
      {pesan.length > 0 && (
        <form action={async () => { await resetObrolanAction(); setPesan([]); }} className="mt-2 text-right">
          <button className="btn-ghost btn-sm text-xs">
            <Icon name="refresh" size={14} />
            Mulai obrolan baru
          </button>
        </form>
      )}
    </div>
  );
}
