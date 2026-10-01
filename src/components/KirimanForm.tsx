import ActionForm from "./ActionForm";
import { Icon } from "./icons";
import { kirimanMasuk } from "@/app/actions-plus";
import { rp } from "@/lib/money";

/** Form uang tambahan (kiriman Ayah dll.) di luar uang mingguan. */
export default function KirimanForm({ pengirim, aturan }: { pengirim: string; aturan: string }) {
  return (
    <ActionForm action={kirimanMasuk} submit={<><Icon name="gift" size={16} />Catat kiriman</>} resetOnOk>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="k-dari" className="label">
            Dari
          </label>
          <input id="k-dari" name="dari" defaultValue={pengirim} className="input" />
        </div>
        <div>
          <label htmlFor="k-nominal" className="label">
            Nominal
          </label>
          <input id="k-nominal" name="nominal" required placeholder={rp(100000)} className="input num" />
        </div>
        <div className="col-span-2">
          <label htmlFor="k-bagi" className="label">
            Masuk ke
          </label>
          <select id="k-bagi" name="bagi" className="input" defaultValue="default">
            <option value="default">Bagi otomatis ({aturan})</option>
            <option value="makan">Semua ke Makan</option>
            <option value="data">Semua ke Paket data</option>
            <option value="paylater">Semua ke Paylater</option>
            <option value="kado">Semua ke Tabungan kado</option>
            <option value="darurat">Semua ke Darurat</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="tandaTerima" defaultChecked className="size-4 accent-[var(--brand)]" />
        Kirim tanda terima ke nomor keluarga
      </label>
    </ActionForm>
  );
}
