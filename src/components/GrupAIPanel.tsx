"use client";

import { lepasGrupAIAction, simpanGrupAIAction } from "@/app/actions-ai";
import ActionForm from "./ActionForm";
import ConfirmButton from "./ConfirmButton";
import { Icon } from "./icons";
import { Badge } from "./ui";

/** AI grup WhatsApp: bot jadi asisten AI umum untuk satu grup; penyedia bergiliran (round robin). */
export default function GrupAIPanel({
  jid,
  aktif,
  mode,
  batas,
  perOrang,
  tanda,
  pakaiHariIni,
  penyedia,
}: {
  jid: string;
  aktif: boolean;
  mode: string;
  batas: number;
  perOrang: number;
  tanda: boolean;
  pakaiHariIni: number;
  /** nama penyedia yang tersambung, urut giliran */
  penyedia: string[];
}) {
  return (
    <div className="card card-pad space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Icon name="message" size={18} className="text-muted" />
          Grup yang dilayani
        </h3>
        <Badge tone={!jid ? "neutral" : aktif ? "ok" : "warn"}>{!jid ? "Belum dipilih" : aktif ? "Aktif" : "Dimatikan"}</Badge>
      </div>
      <p className="text-sm text-muted">
        Di grup ini bot jadi asisten AI biasa untuk semua anggota (tanpa data DompetKos). Pakai awalan <code>/ai</code>, contoh <code>/ai apa itu fotosintesis?</code>. Penyedia dipakai bergiliran:{" "}
        {penyedia.length ? <b>{penyedia.join(" → ")}</b> : "belum ada yang tersambung"}. Kalau satu gagal, langsung pindah ke berikutnya.
      </p>
      <p className="text-sm">
        <span className="font-medium">Cara memilih grup:</span> masukkan bot ke grupnya, lalu dari nomor pemilik ketik <code>!aigrup aktif</code> di grup itu. ID grup terisi sendiri. Perintah lain: <code>!aigrup status</code>, <code>mati</code>, <code>mode perintah|pertanyaan|semua</code>, <code>reset</code>.
      </p>

      <ActionForm action={simpanGrupAIAction} submit="Simpan" submitClass="btn-secondary">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="grup_ai_jid" className="label">
              ID grup (diisi otomatis oleh <code>!aigrup aktif</code>)
            </label>
            <input id="grup_ai_jid" name="grup_ai_jid" defaultValue={jid} placeholder="1203630xxxxxxxxx@g.us" className="input" autoComplete="off" />
          </div>
          <label htmlFor="grup_ai_aktif" className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5">
            <input type="checkbox" id="grup_ai_aktif" name="grup_ai_aktif" defaultChecked={aktif} className="size-4 shrink-0 accent-[var(--brand)]" />
            <span className="text-sm font-medium">AI grup aktif</span>
          </label>
          <label htmlFor="grup_ai_tanda" className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2.5">
            <input type="checkbox" id="grup_ai_tanda" name="grup_ai_tanda" defaultChecked={tanda} className="size-4 shrink-0 accent-[var(--brand)]" />
            <span className="text-sm font-medium">Tampilkan penyedia &amp; model di bawah jawaban</span>
          </label>
          <div>
            <label htmlFor="grup_ai_mode" className="label">
              Kapan bot menjawab
            </label>
            <select id="grup_ai_mode" name="grup_ai_mode" defaultValue={mode} className="input">
              <option value="perintah">Hanya pesan berawalan /ai (atau bot di-mention / dibalas)</option>
              <option value="pertanyaan">/ai + pesan berbentuk pertanyaan</option>
              <option value="semua">Semua pesan teks (ramai & boros kuota)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="grup_ai_batas_harian" className="label">
                Batas / hari ({pakaiHariIni} terpakai)
              </label>
              <input id="grup_ai_batas_harian" name="grup_ai_batas_harian" type="number" min={1} max={2000} defaultValue={batas} className="input num" />
            </div>
            <div>
              <label htmlFor="grup_ai_per_orang_menit" className="label">
                Per orang / menit
              </label>
              <input id="grup_ai_per_orang_menit" name="grup_ai_per_orang_menit" type="number" min={1} max={20} defaultValue={perOrang} className="input num" />
            </div>
          </div>
        </div>
      </ActionForm>

      {jid && (
        <form action={lepasGrupAIAction}>
          <ConfirmButton pesan="Lepas grup ini dari AI grup? Bot berhenti menjawab di sana." className="btn-ghost btn-sm text-bad">
            <Icon name="trash" size={15} />
            Lepas grup
          </ConfirmButton>
        </form>
      )}

      <p className="hint">
        Jatah AI grup terpisah dari jatah AI pemilik. Isi pesan grup dikirim ke penyedia AI yang bergiliran (Claude, Gemini, OpenRouter); di paket gratis, data bisa dipakai penyedia untuk meningkatkan layanan. Beri tahu anggota grup.
      </p>
    </div>
  );
}
