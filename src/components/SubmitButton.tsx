"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Menyimpan…" : children}
    </button>
  );
}
