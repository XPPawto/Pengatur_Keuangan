"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { catatPengeluaran, type FormState } from "@/app/actions";
import { ENVELOPE_ICON, Icon } from "./icons";
import { FormMessage } from "./ui";

interface Opsi {
  kode: string;
  nama: string;
  terkunci: boolean;
}

export default function CatatForm({
  amplop,
  awal,
  tanggal,
}: {
  amplop: Opsi[];
  awal: { nominal?: string; catatan?: string; kode?: string };
  tanggal: { hariIni: string; min: string };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(catatPengeluaran, {});
  const formRef = useRef<HTMLFormElement>(null);
  const nominalRef = useRef<HTMLInputElement>(null);
  const [kode, setKode] = useState(awal.kode ?? "makan");
  const terkunci = amplop.find((a) => a.kode === kode)?.terkunci;

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      nominalRef.current?.focus();
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="card card-pad space-y-5">
      <div>
        <label htmlFor="nominal" className="label">
          Nominal
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg font-semibold text-muted">Rp</span>
          <input
            ref={nominalRef}
            id="nominal"
            name="nominal"
            inputMode="text"
            placeholder="12k, 12rb, 12.000"
            defaultValue={awal.nominal}
            required
            autoFocus
            className="input num !py-3.5 !pl-11 !text-2xl font-bold"
            autoComplete="off"
          />
        </div>
        <p className="hint">Format bebas seperti di WhatsApp: 5k, 12rb, 12.000, 1,5jt.</p>
      </div>

      <fieldset>
        <legend className="label">Amplop</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {amplop.map((a) => (
            <label
              key={a.kode}
              className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center text-xs font-medium transition ${
                kode === a.kode ? "border-brand bg-brand-soft text-brand" : "border-line-strong text-fg-2 hover:bg-subtle"
              }`}
            >
              <input type="radio" name="kode" value={a.kode} checked={kode === a.kode} onChange={() => setKode(a.kode)} className="sr-only" />
              <Icon name={ENVELOPE_ICON[a.kode]} size={20} />
              <span className="flex items-center gap-1">
                {a.nama.split(" ")[0]}
                {a.terkunci && <Icon name="lock" size={11} />}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_180px]">
        <div>
          <label htmlFor="catatan" className="label">
            Catatan
          </label>
          <input id="catatan" name="catatan" placeholder="tempe, telur, sabun…" defaultValue={awal.catatan} className="input" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="tanggal" className="label">
            Tanggal
          </label>
          <input id="tanggal" name="tanggal" type="date" defaultValue={tanggal.hariIni} min={tanggal.min} max={tanggal.hariIni} className="input" />
        </div>
      </div>

      {terkunci && (
        <div className="rounded-xl bg-warn-bg p-3">
          <label htmlFor="konfirmasi" className="label !text-warn">
            Amplop terkunci. Ketik <b>YAKIN AMBIL TABUNGAN</b> untuk lanjut
          </label>
          <input id="konfirmasi" name="konfirmasi" className="input" autoComplete="off" />
        </div>
      )}

      <FormMessage state={state} />
      <button className="btn w-full !min-h-12 text-[15px]" disabled={pending}>
        <Icon name="check" size={18} />
        {pending ? "Menyimpan…" : "Simpan pengeluaran"}
      </button>
    </form>
  );
}
