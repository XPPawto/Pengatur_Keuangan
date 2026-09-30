"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icons";
import { FormMessage } from "@/components/ui";
import { login, loginKode, mintaKodeLogin, type FormState } from "../actions";

export default function LoginForm({ otp }: { otp: boolean }) {
  const [mode, setMode] = useState<"password" | "kode">("password");
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  const [kodeState, kodeAction, kodePending] = useActionState<FormState, FormData>(loginKode, {});
  const [mintaState, mintaAction, mintaPending] = useActionState<FormState>(mintaKodeLogin, {});

  return (
    <div className="card card-pad space-y-4">
      {otp && (
        <div role="tablist" aria-label="Cara masuk" className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1">
          {(["password", "kode"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition ${mode === m ? "bg-card text-fg shadow-sm" : "text-muted"}`}
            >
              <Icon name={m === "password" ? "key" : "message"} size={16} />
              {m === "password" ? "Password" : "Kode WhatsApp"}
            </button>
          ))}
        </div>
      )}

      {mode === "password" ? (
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="password" className="label">
              Password
            </label>
            <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" className="input" />
          </div>
          <FormMessage state={state} />
          <button type="submit" disabled={pending} className="btn w-full">
            {pending ? "Memeriksa…" : "Masuk"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <form action={mintaAction}>
            <button className="btn-secondary w-full" disabled={mintaPending}>
              <Icon name="send" size={16} />
              {mintaPending ? "Mengirim…" : "Kirim kode ke WhatsApp"}
            </button>
          </form>
          <FormMessage state={mintaState} />
          <form action={kodeAction} className="space-y-4">
            <div>
              <label htmlFor="kode" className="label">
                Kode 6 digit
              </label>
              <input id="kode" name="kode" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="input num text-center text-xl tracking-[0.4em]" />
            </div>
            <FormMessage state={kodeState} />
            <button type="submit" disabled={kodePending} className="btn w-full">
              {kodePending ? "Memeriksa…" : "Masuk"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
