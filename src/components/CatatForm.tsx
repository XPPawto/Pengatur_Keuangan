"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { catatPengeluaran, type FormState } from "@/app/actions";

interface Opsi {
  kode: string;
  nama: string;
  terkunci: boolean;
}

export default function CatatForm({ amplop, awal }: { amplop: Opsi[]; awal: { nominal?: string; catatan?: string; kode?: string } }) {
  const [state, action, pending] = useActionState<FormState, FormData>(catatPengeluaran, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [kode, setKode] = useState(awal.kode ?? "makan");
  const terkunci = amplop.find((a) => a.kode === kode)?.terkunci;

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="card space-y-4">
      <div>
        <label htmlFor="nominal" className="label">
          Nominal
        </label>
        <input id="nominal" name="nominal" inputMode="text" placeholder="12k, 12rb, 12.000" defaultValue={awal.nominal} required className="input" autoComplete="off" />
      </div>
      <div>
        <label htmlFor="kode" className="label">
          Amplop
        </label>
        <select id="kode" name="kode" value={kode} onChange={(e) => setKode(e.target.value)} className="input">
          {amplop.map((a) => (
            <option key={a.kode} value={a.kode}>
              {a.nama}
              {a.terkunci ? " 🔒" : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="catatan" className="label">
          Catatan
        </label>
        <input id="catatan" name="catatan" placeholder="tempe, telur…" defaultValue={awal.catatan} className="input" autoComplete="off" />
      </div>
      {terkunci && (
        <div>
          <label htmlFor="konfirmasi" className="label">
            Amplop terkunci. Ketik <b>YAKIN AMBIL TABUNGAN</b> buat lanjut
          </label>
          <input id="konfirmasi" name="konfirmasi" className="input" autoComplete="off" />
        </div>
      )}
      {state.error && (
        <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok">
          {state.ok}
        </p>
      )}
      <button className="btn w-full" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan"}
      </button>
    </form>
  );
}
