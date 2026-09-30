"use client";

import { useActionState } from "react";
import { login, type FormState } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="card space-y-4">
      <div>
        <label htmlFor="password" className="label">
          Password
        </label>
        <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" className="input" />
      </div>
      {state.error && (
        <p role="alert" className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn w-full">
        {pending ? "Masuk…" : "Masuk"}
      </button>
    </form>
  );
}
