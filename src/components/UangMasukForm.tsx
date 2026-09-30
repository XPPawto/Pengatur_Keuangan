"use client";

import { useActionState } from "react";
import { usulkanUangMasuk, type FormState } from "@/app/actions";

export default function UangMasukForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(usulkanUangMasuk, {});
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="nominal" className="label">
          Nominal masuk (mis. 300k)
        </label>
        <input id="nominal" name="nominal" inputMode="text" placeholder="300k" required className="input" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button className="btn w-full" disabled={pending}>
        {pending ? "Menghitung…" : "Lihat usulan pembagian"}
      </button>
    </form>
  );
}
