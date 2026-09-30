"use client";

import { useActionState } from "react";
import { hapusTransaksi, ubahTransaksi, type FormState } from "@/app/actions";
import { rp } from "@/lib/money";
import { ENVELOPE_ICON, Icon } from "./icons";
import { FormMessage } from "./ui";

export interface TxRow {
  id: number;
  nominal: number;
  catatan: string;
  sumber: string;
  kode: string;
  namaAmplop: string;
  jam: string;
  pesanAsli: string | null;
}

export default function TransaksiItem({ tx, amplop }: { tx: TxRow; amplop: { kode: string; nama: string; terkunci: boolean }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(ubahTransaksi, {});
  return (
    <details className="group border-b border-line last:border-0">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-fg-2">
          <Icon name={ENVELOPE_ICON[tx.kode]} size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tx.catatan || "(tanpa catatan)"}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {tx.namaAmplop} · {tx.jam}
            <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase ${tx.sumber === "wa" ? "bg-ok-bg text-ok" : "bg-subtle text-fg-2"}`}>{tx.sumber === "wa" ? "WA" : "Web"}</span>
          </p>
        </div>
        <span className="num shrink-0 text-sm font-semibold">{rp(tx.nominal)}</span>
        <Icon name="chevron-down" size={16} className="shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <form action={action} className="space-y-3 pb-4 pl-12">
        <input type="hidden" name="id" value={tx.id} />
        {tx.pesanAsli && <p className="rounded-lg bg-subtle px-3 py-2 text-xs text-muted">Pesan WA: “{tx.pesanAsli}”</p>}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={`n${tx.id}`} className="label">
              Nominal
            </label>
            <input id={`n${tx.id}`} name="nominal" defaultValue={tx.nominal} className="input-sm num" />
          </div>
          <div>
            <label htmlFor={`k${tx.id}`} className="label">
              Amplop
            </label>
            <select id={`k${tx.id}`} name="kode" defaultValue={tx.kode} className="input-sm">
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
          <input id={`c${tx.id}`} name="catatan" defaultValue={tx.catatan} className="input-sm" />
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Pindah ke amplop terkunci?</summary>
          <label htmlFor={`f${tx.id}`} className="label mt-2">
            Ketik <b>YAKIN AMBIL TABUNGAN</b>
          </label>
          <input id={`f${tx.id}`} name="konfirmasi" className="input-sm" autoComplete="off" />
        </details>
        <FormMessage state={state} />
        <div className="flex gap-2">
          <button className="btn btn-sm" disabled={pending}>
            Simpan
          </button>
          <button
            type="submit"
            formAction={hapusTransaksi}
            className="btn-danger btn-sm"
            onClick={(e) => {
              if (!confirm("Hapus catatan ini?")) e.preventDefault();
            }}
          >
            <Icon name="trash" size={15} />
            Hapus
          </button>
        </div>
      </form>
    </details>
  );
}
