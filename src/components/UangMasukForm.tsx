"use client";

import { useActionState } from "react";
import { usulkanUangMasuk, type FormState } from "@/app/actions";
import { FormMessage } from "./ui";

export default function UangMasukForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(usulkanUangMasuk, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-2">
        <label htmlFor="nominal-masuk" className="sr-only">
          Nominal masuk
        </label>
        <input id="nominal-masuk" name="nominal" placeholder="300k" required className="input num flex-1" />
        <button className="btn shrink-0" disabled={pending}>
          {pending ? "Menghitung…" : "Lihat usulan"}
        </button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
