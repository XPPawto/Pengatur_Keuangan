import ProgressBar from "./ProgressBar";
import { ENVELOPE_ICON, Icon } from "./icons";
import { TONE_TEXT, toneFor, type Tone } from "@/lib/format";
import { rp } from "@/lib/money";
import type { EnvelopeBalance } from "@/lib/services/envelopes";
import { fmtTanggal } from "@/lib/time";

interface Props {
  balances: EnvelopeBalance[];
  targetKado?: number;
  tagihanPaylater?: { nominal: number; jatuhTempo: string } | null;
}

/** Daftar amplop: saldo, bar progres, dan keterangan singkat. Dipakai di Beranda & halaman Amplop. */
export default function EnvelopeList({ balances, targetKado, tagihanPaylater }: Props) {
  return (
    <ul className="divide-y divide-line">
      {balances.map((b) => {
        let persen = 0;
        let tone: Tone | "brand" = "brand";
        let info = "";
        if (b.kode === "kado" && targetKado) {
          persen = (b.saldo / targetKado) * 100;
          info = `${Math.round(persen)}% dari target ${rp(targetKado)}`;
        } else if (b.kode === "paylater" && tagihanPaylater) {
          persen = (b.saldo / Math.max(1, tagihanPaylater.nominal)) * 100;
          info =
            b.saldo >= tagihanPaylater.nominal
              ? `Cukup untuk tagihan ${rp(tagihanPaylater.nominal)} (${fmtTanggal(tagihanPaylater.jatuhTempo)})`
              : `Kurang ${rp(tagihanPaylater.nominal - b.saldo)} untuk tagihan ${fmtTanggal(tagihanPaylater.jatuhTempo)}`;
        } else if (!b.kumulatif) {
          persen = b.alokasi ? (b.saldo / b.alokasi) * 100 : 0;
          tone = toneFor(b.saldo, b.alokasi);
          info = `Terpakai ${rp(b.terpakai)} dari ${rp(b.alokasi)}`;
        } else {
          info = `Tabungan · +${rp(b.alokasi)} minggu ini`;
        }
        return (
          <li key={b.kode} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-subtle text-fg-2">
              <Icon name={ENVELOPE_ICON[b.kode]} size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  {b.nama}
                  {b.terkunci && <Icon name="lock" size={13} className="text-muted" aria-label="terkunci" />}
                </span>
                <span className={`num text-[15px] font-semibold ${tone === "brand" ? "" : TONE_TEXT[tone]}`}>{rp(b.saldo)}</span>
              </div>
              {b.kode !== "darurat" && (
                <div className="mt-1.5">
                  <ProgressBar persen={persen} tone={tone} label={b.nama} />
                </div>
              )}
              <p className="mt-1 truncate text-xs text-muted">{info}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
