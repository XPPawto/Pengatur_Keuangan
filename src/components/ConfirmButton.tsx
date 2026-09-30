"use client";

import type { ReactNode } from "react";

/** Tombol submit dengan konfirmasi browser (untuk hapus, dsb.). */
export default function ConfirmButton({ pesan, children, className = "btn-danger btn-sm", formAction }: { pesan: string; children: ReactNode; className?: string; formAction?: (f: FormData) => void | Promise<void> }) {
  return (
    <button
      type="submit"
      formAction={formAction}
      className={className}
      onClick={(e) => {
        if (!confirm(pesan)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
