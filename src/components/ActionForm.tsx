"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/app/actions";
import { FormMessage } from "./ui";

/** Form generik untuk server action: status sukses/galat, tombol dengan state pending. */
export default function ActionForm({
  action,
  children,
  submit,
  className = "space-y-3",
  submitClass = "btn",
  resetOnOk = false,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: ReactNode;
  submit: ReactNode;
  className?: string;
  submitClass?: string;
  resetOnOk?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnOk && state.ok) ref.current?.reset();
  }, [state, resetOnOk]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <FormMessage state={state} />
      <button className={submitClass} disabled={pending}>
        {pending ? "Menyimpan…" : submit}
      </button>
    </form>
  );
}
