"use client";

import { useActionState, useState } from "react";
import { simulasiAction, type SimulasiState } from "@/app/actions-plus";
import { Icon } from "./icons";
import { Alert } from "./ui";

export default function Simulator() {
  const [state, action, pending] = useActionState<SimulasiState, FormData>(simulasiAction, {});
  const [jenis, setJenis] = useState<"beli" | "masuk">("beli");
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Jenis simulasi" className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
        {(["beli", "masuk"] as const).map((j) => (
          <button key={j} type="button" role="tab" aria-selected={jenis === j} onClick={() => setJenis(j)} className={`min-h-9 rounded-lg text-sm font-medium ${jenis === j ? "bg-card shadow-sm" : "text-muted"}`}>
            {j === "beli" ? "Kalau beli sesuatu" : "Kalau uang masuk berubah"}
          </button>
        ))}
      </div>
      <form action={action} className="grid grid-cols-2 gap-3">
        <input type="hidden" name="jenis" value={jenis} />
        {jenis === "beli" ? (
          <div>
            <label htmlFor="sim-barang" className="label">
              Barang
            </label>
            <input id="sim-barang" name="barang" placeholder="sepatu" className="input" />
          </div>
        ) : (
          <div>
            <label htmlFor="sim-minggu" className="label">
              Selama (minggu)
            </label>
            <input id="sim-minggu" name="minggu" type="number" min={1} max={8} defaultValue={3} className="input num" />
          </div>
        )}
        <div>
          <label htmlFor="sim-nominal" className="label">
            {jenis === "beli" ? "Harga" : "Uang mingguan"}
          </label>
          <input id="sim-nominal" name="nominal" required placeholder={jenis === "beli" ? "150k" : "250k"} className="input num" />
        </div>
        <button className="btn col-span-2" disabled={pending}>
          <Icon name="compass" size={17} />
          {pending ? "Menghitung…" : "Simulasikan"}
        </button>
      </form>
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.poin && (
        <div className={`rounded-xl border p-4 ${state.aman ? "border-ok/40 bg-ok-bg" : "border-bad/40 bg-bad-bg"}`}>
          <p className={`flex items-center gap-2 font-semibold ${state.aman ? "text-ok" : "text-bad"}`}>
            <Icon name={state.aman ? "check-circle" : "alert"} size={18} />
            {state.judul}: {state.aman ? "masih aman" : "berisiko"}
          </p>
          <ul className="mt-2 space-y-1 text-sm text-fg">
            {state.poin.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
