"use client";

import { useActionState } from "react";
import { cekSaldoAsli, selesaikanRekon, type RekonState } from "@/app/actions-plus";
import { rp } from "@/lib/money";
import { Icon } from "./icons";
import { Alert } from "./ui";

export default function RekonForm({ saldoSistem }: { saldoSistem: number }) {
  const [state, action, pending] = useActionState<RekonState, FormData>(cekSaldoAsli, {});
  const rec = state.rec;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Menurut catatan, total uang lo sekarang <b className="num text-fg">{rp(saldoSistem)}</b>. Hitung uang asli (dompet + semua e-wallet), lalu cocokkan.
      </p>
      <form action={action} className="flex gap-2">
        <label htmlFor="saldo-asli" className="sr-only">
          Total uang asli
        </label>
        <input id="saldo-asli" name="saldo" required placeholder="412k" className="input num flex-1" />
        <button className="btn shrink-0" disabled={pending}>
          <Icon name="scale" size={17} />
          Cocokkan
        </button>
      </form>
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      {rec && rec.selisih !== 0 && (
        <div className="rounded-xl border border-line p-3 text-sm">
          <p>
            Catatan {rp(rec.saldoSistem)} · uang asli {rp(rec.saldoAsli)} →{" "}
            <b className={rec.selisih < 0 ? "text-bad" : "text-ok"}>{rec.selisih < 0 ? `kurang ${rp(-rec.selisih)}` : `lebih ${rp(rec.selisih)}`}</b>
          </p>
          <form action={selesaikanRekon} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="id" value={rec.id} />
            {rec.selisih < 0 ? (
              <>
                <span className="w-full text-xs text-muted">Catat sebagai pengeluaran yang kelewat ke:</span>
                <button name="tindakan" value="makan" className="btn btn-sm">Makan</button>
                <button name="tindakan" value="data" className="btn-secondary btn-sm">Paket data</button>
                <button name="tindakan" value="darurat" className="btn-secondary btn-sm">Darurat</button>
              </>
            ) : (
              <button name="tindakan" value="uang_ekstra" className="btn btn-sm">Masukkan ke Darurat</button>
            )}
            <button name="tindakan" value="abaikan" className="btn-ghost btn-sm">Abaikan</button>
          </form>
        </div>
      )}
    </div>
  );
}
