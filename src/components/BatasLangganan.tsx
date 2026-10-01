import ProgressBar from "./ProgressBar";
import type { batasClaude } from "@/lib/ai/panggil";
import { wibHM } from "@/lib/time";

type Batas = Awaited<ReturnType<typeof batasClaude>>;

function jam(iso: string) {
  const { jam, menit } = wibHM(new Date(iso));
  return `${String(jam).padStart(2, "0")}.${String(menit).padStart(2, "0")}`;
}

/** Bar pemakaian langganan Claude: sesi 5 jam & mingguan (angka dari respons Claude terakhir yang dilihat bot). */
export default function BatasLangganan({ batas, ringkas = false }: { batas: Batas; ringkas?: boolean }) {
  if (!batas.length) {
    return <p className="text-xs text-muted">Batas sesi 5 jam & mingguan muncul setelah bot memanggil Claude (dibaca dari respons Claude).</p>;
  }
  const terbaru = batas.map((b) => b.diperbarui).sort().at(-1)!;
  return (
    <div className="space-y-2.5">
      {batas.map((b) => (
        <div key={b.kode}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-muted">{b.label}</span>
            <span className="num font-medium">{Math.round(b.persen)}%</span>
          </div>
          <div className="mt-1">
            <ProgressBar persen={b.persen} tone={b.persen >= 90 ? "bad" : b.persen >= 70 ? "warn" : "brand"} label={`${b.label} terpakai`} />
          </div>
          {!ringkas && <p className="mt-0.5 text-[11px] text-muted">{b.sudahReset ? "Sudah reset" : b.reset ? `Reset ${b.reset}` : "Waktu reset belum diketahui"}</p>}
        </div>
      ))}
      <p className="text-[11px] text-muted">
        Diperbarui {jam(terbaru)} WIB dari respons Claude. Pemakaian lo di claude.ai ikut terhitung dan baru kelihatan di sini setelah bot memanggil Claude lagi.
      </p>
    </div>
  );
}
