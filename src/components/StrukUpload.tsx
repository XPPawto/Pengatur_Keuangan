"use client";

import { useActionState, useState } from "react";
import { bacaStrukAction, simpanStrukAction, type StrukState } from "@/app/actions-plus";
import { rp } from "@/lib/money";
import { Icon } from "./icons";
import { Alert } from "./ui";

const AMPLOP = [
  { kode: "makan", nama: "Makan" },
  { kode: "data", nama: "Paket data" },
  { kode: "darurat", nama: "Darurat" },
];

/** Foto struk → Claude (atau OCR lokal) → konfirmasi → dicatat (sekaligus atau per item). */
export default function StrukUpload() {
  const [baca, bacaAction, membaca] = useActionState<StrukState, FormData>(bacaStrukAction, {});
  const [simpan, simpanAction, menyimpan] = useActionState<StrukState, FormData>(simpanStrukAction, {});
  const [mode, setMode] = useState<"total" | "rinci">("total");
  const h = baca.hasil;

  return (
    <div className="space-y-3">
      <form action={bacaAction} className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary cursor-pointer">
          <Icon name="camera" size={17} />
          Pilih / ambil foto
          <input type="file" name="foto" accept="image/*" capture="environment" className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
        </label>
        {membaca && <span className="flex items-center gap-2 text-sm text-muted"><Icon name="refresh" size={15} className="animate-spin" />Membaca struk… (pakai AI bisa sampai 30 detik)</span>}
      </form>
      {baca.error && <Alert tone="bad">{baca.error}</Alert>}
      {baca.info && <Alert tone="info">{baca.info}</Alert>}
      {simpan.ok && <Alert tone="ok">{simpan.ok}</Alert>}
      {simpan.error && <Alert tone="bad">{simpan.error}</Alert>}
      {h && !simpan.ok && (
        <form action={simpanAction} className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-sm">
            <b>{h.toko ?? "Struk"}</b> · total <b className="num">{rp(h.total ?? 0)}</b> · {h.items.length} item
            {baca.olehAI && <span className="ml-2 inline-flex items-center gap-1 text-xs text-brand"><Icon name="bot" size={13} />dibaca AI</span>}
          </p>
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-subtle p-1 text-sm">
            <button type="button" role="tab" aria-selected={mode === "total"} onClick={() => setMode("total")} className={`min-h-8 rounded-md ${mode === "total" ? "bg-card shadow-sm" : "text-muted"}`}>
              Catat total
            </button>
            <button type="button" role="tab" aria-selected={mode === "rinci"} onClick={() => setMode("rinci")} disabled={!h.items.length} className={`min-h-8 rounded-md ${mode === "rinci" ? "bg-card shadow-sm" : "text-muted"}`}>
              Per item
            </button>
          </div>
          <input type="hidden" name="mode" value={mode} />
          {mode === "total" ? (
            <div className="grid grid-cols-2 gap-2">
              <input name="total" defaultValue={h.total ?? ""} className="input-sm num" aria-label="Total" />
              <select name="kode" defaultValue={baca.saranKode ?? "makan"} className="input-sm" aria-label="Amplop">
                {AMPLOP.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.nama}
                  </option>
                ))}
              </select>
              <input name="catatan" defaultValue={`Belanja ${h.toko ?? ""}`.trim()} className="input-sm col-span-2" aria-label="Catatan" />
            </div>
          ) : (
            <ItemEditor key={JSON.stringify(h)} items={h.items} saran={baca.saranKode ?? "makan"} kodeItem={baca.kodeItem} />
          )}
          <button className="btn w-full" disabled={menyimpan}>
            <Icon name="check" size={17} />
            {menyimpan ? "Menyimpan…" : "Simpan"}
          </button>
        </form>
      )}
    </div>
  );
}

function ItemEditor({ items, saran, kodeItem }: { items: { nama: string; harga: number }[]; saran: string; kodeItem?: string[] }) {
  const [rows, setRows] = useState(items.map((i, n) => ({ ...i, kode: kodeItem?.[n] ?? saran })));
  return (
    <>
      <input type="hidden" name="items" value={JSON.stringify(rows)} />
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_90px_100px] gap-1.5">
            <input value={r.nama} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, nama: e.target.value } : x)))} className="input-sm" aria-label="Nama item" />
            <input value={r.harga} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, harga: Number(e.target.value.replace(/\D/g, "")) } : x)))} className="input-sm num" aria-label="Harga" />
            <select value={r.kode} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, kode: e.target.value } : x)))} className="input-sm" aria-label="Amplop">
              {AMPLOP.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.nama}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </>
  );
}
