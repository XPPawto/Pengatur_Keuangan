"use client";

import { useActionState } from "react";
import { hapusTransaksi, ubahTransaksi, type FormState } from "@/app/actions";
import { rp } from "@/lib/money";

export interface TxRow {
  id: number;
  nominal: number;
  catatan: string;
  sumber: string;
  kode: string;
  namaAmplop: string;
  jam: string;
}

export default function TransaksiItem({ tx, amplop }: { tx: TxRow; amplop: { kode: string; nama: string; terkunci: boolean }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(ubahTransaksi, {});
  return (
    <details className="group border-b border-line last:border-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{tx.catatan || "(tanpa catatan)"}</p>
          <p className="text-xs text-muted">
            {tx.namaAmplop} · {tx.jam} ·{" "}
            <span className={`rounded px-1 ${tx.sumber === "wa" ? "bg-ok-bg text-ok" : "bg-line text-muted"}`}>{tx.sumber === "wa" ? "WA" : "Web"}</span>
          </p>
        </div>
        <span className="shrink-0 font-semibold">{rp(tx.nominal)}</span>
      </summary>
      <form action={action} className="space-y-3 pb-4">
        <input type="hidden" name="id" value={tx.id} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`n${tx.id}`} className="label">
              Nominal
            </label>
            <input id={`n${tx.id}`} name="nominal" defaultValue={tx.nominal} className="input" />
          </div>
          <div>
            <label htmlFor={`k${tx.id}`} className="label">
              Amplop
            </label>
            <select id={`k${tx.id}`} name="kode" defaultValue={tx.kode} className="input">
              {amplop.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.nama}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`c${tx.id}`} className="label">
            Catatan
          </label>
          <input id={`c${tx.id}`} name="catatan" defaultValue={tx.catatan} className="input" />
        </div>
        <div>
          <label htmlFor={`f${tx.id}`} className="label">
            Pindah ke amplop terkunci? Ketik <b>YAKIN AMBIL TABUNGAN</b>
          </label>
          <input id={`f${tx.id}`} name="konfirmasi" className="input" autoComplete="off" />
        </div>
        {state.error && <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">{state.error}</p>}
        {state.ok && <p role="status" className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok">{state.ok}</p>}
        <div className="flex gap-2">
          <button className="btn flex-1" disabled={pending}>
            Simpan
          </button>
          <button
            type="submit"
            formAction={hapusTransaksi}
            className="btn-danger"
            onClick={(e) => {
              if (!confirm("Hapus catatan ini?")) e.preventDefault();
            }}
          >
            Hapus
          </button>
        </div>
      </form>
    </details>
  );
}
