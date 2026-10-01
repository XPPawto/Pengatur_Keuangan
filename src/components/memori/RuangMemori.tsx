"use client";

import dynamic from "next/dynamic";
import { useCallback, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { KejadianMemori, NodePeta, PetaMemori } from "@/lib/ai/petaMemori";
import { batalkanMemoriAction, ingatAction, lupakanAction, renungkanAction, simpanPengaturanMemoriAction, ubahMemoriAction, ujiIngatanAction, type HasilUjiIngatan } from "@/app/actions-ai";
import ActionForm from "../ActionForm";
import { Icon } from "../icons";
import { Badge, Card } from "../ui";
import { WARNA_NODE, type ModePeta } from "./KanvasMemori";

const KanvasMemori = dynamic(() => import("./KanvasMemori"), {
  ssr: false,
  loading: () => <div className="h-[400px] animate-pulse rounded-2xl bg-[#060a16] sm:h-[540px]" aria-label="Memuat peta memori" />,
});

const MAKS_ENTRI = 280;

function umur(iso: string, sekarang: string): string {
  const mnt = Math.max(0, Math.round((new Date(sekarang).getTime() - new Date(iso).getTime()) / 60_000));
  if (mnt < 60) return "baru saja";
  const jam = Math.round(mnt / 60);
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.round(jam / 24);
  if (hari < 14) return `${hari} hari lalu`;
  if (hari < 60) return `${Math.round(hari / 7)} minggu lalu`;
  return `${Math.round(hari / 30)} bulan lalu`;
}

const NAMA_TIPE: Record<NodePeta["tipe"], string> = { profil: "Profil", catatan: "Catatan", topik: "Topik obrolan", kata: "Kata penghubung" };

// ---------------------------------------------------------------- kartu kapasitas

function Cincin({ persen, warna, ukuran = 64 }: { persen: number; warna: string; ukuran?: number }) {
  const r = ukuran / 2 - 6;
  const k = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, persen));
  return (
    <svg width={ukuran} height={ukuran} viewBox={`0 0 ${ukuran} ${ukuran}`} className="size-[52px] shrink-0 sm:size-16" aria-hidden="true">
      <circle cx={ukuran / 2} cy={ukuran / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle cx={ukuran / 2} cy={ukuran / 2} r={r} fill="none" stroke={p >= 0.9 ? "var(--bad)" : warna} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${p * k} ${k}`} transform={`rotate(-90 ${ukuran / 2} ${ukuran / 2})`} style={{ transition: "stroke-dasharray .6s ease" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="num fill-[var(--fg)] text-[13px] font-bold">
        {Math.round(p * 100)}%
      </text>
    </svg>
  );
}

function KartuKapasitas({ judul, warna, pakai, batas, jumlah }: { judul: string; warna: string; pakai: number; batas: number; jumlah: number }) {
  return (
    <div className="card flex items-center gap-2.5 p-3 sm:gap-3.5 sm:p-5">
      <Cincin persen={batas ? pakai / batas : 0} warna={warna} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
          <span className="size-2 rounded-full" style={{ background: warna, boxShadow: `0 0 8px ${warna}` }} />
          {judul}
        </p>
        <p className="num mt-0.5 text-lg font-bold tracking-tight">
          {pakai}
          <span className="text-sm font-medium text-muted"> / {batas}</span>
        </p>
        <p className="text-xs text-muted">
          {jumlah} entri<span className="hidden sm:inline"> · karakter terpakai</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- utama

export default function RuangMemori({ peta, ingatanAktif, tiap }: { peta: PetaMemori; ingatanAktif: boolean; tiap: number }) {
  const [mode, setMode] = useState<ModePeta>("rasi");
  const [terpilih, setTerpilih] = useState<string | null>(null);
  const [sorot, setSorot] = useState<Set<string> | null>(null);
  const [uji, setUji] = useState<{ query: string; hasil: HasilUjiIngatan } | null>(null);
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const [filter, setFilter] = useState<"semua" | "profil" | "catatan" | "ai" | "saya">("semua");
  const [cari, setCari] = useState("");
  const [sibuk, mulaiAksi] = useTransition();
  const petaRef = useRef<HTMLDivElement>(null);

  const node = useMemo(() => new Map(peta.node.map((n) => [n.id, n])), [peta.node]);
  const tetangga = useMemo(() => {
    const m = new Map<string, { id: string; jenis: "kata" | "mirip"; w: number }[]>();
    const tambah = (a: string, b: string, jenis: "kata" | "mirip", w: number) => (m.get(a) ?? m.set(a, []).get(a)!).push({ id: b, jenis, w });
    for (const s of peta.sisi) {
      tambah(s.a, s.b, s.jenis, s.w);
      tambah(s.b, s.a, s.jenis, s.w);
    }
    return m;
  }, [peta.sisi]);
  const memori = useMemo(() => peta.node.filter((n) => n.tipe === "profil" || n.tipe === "catatan"), [peta.node]);

  const pilih = useCallback((id: string | null) => setTerpilih(id), []);
  const lihatDiPeta = (id: string) => {
    setTerpilih(id);
    petaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const lapor = (ok: boolean, teks: string) => setPesan({ ok, teks });

  const jalankanUji = (query: string) => {
    if (!query.trim()) return;
    mulaiAksi(async () => {
      const hasil = await ujiIngatanAction(query);
      setUji({ query, hasil });
      const ids = new Set<string>();
      for (const m of hasil.memori) ids.add(`m${m.id}`);
      for (const k of hasil.kata) for (const p of ["t:", "k:"]) if (node.has(`${p}${k}`)) ids.add(`${p}${k}`);
      setSorot(ids.size ? ids : null);
      if (ids.size) petaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const tampilMemori = memori.filter((n) => {
    if (filter === "profil" && n.tipe !== "profil") return false;
    if (filter === "catatan" && n.tipe !== "catatan") return false;
    if (filter === "ai" && n.sumber !== "asisten") return false;
    if (filter === "saya" && n.sumber === "asisten") return false;
    return !cari.trim() || (n.teks ?? "").toLowerCase().includes(cari.trim().toLowerCase());
  });
  const profil = peta.pemakaian.find((p) => p.jenis === "profil")!;
  const catatan = peta.pemakaian.find((p) => p.jenis === "catatan")!;
  const sisaGiliran = Math.max(0, tiap - peta.belajar.giliranBaru);

  return (
    <div className="space-y-5">
      {/* ringkasan */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
        <KartuKapasitas judul="Profil" warna={WARNA_NODE.profil} {...profil} />
        <KartuKapasitas judul="Catatan" warna={WARNA_NODE.catatan} {...catatan} />
        <div className="card p-3 sm:p-5">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
            <Icon name="message" size={16} />
            Obrolan
          </p>
          <p className="num mt-1 text-2xl font-bold tracking-tight">{peta.pesanTerindeks.toLocaleString("id-ID")}</p>
          <p className="mt-0.5 text-xs text-muted">pesan terindeks{ingatanAktif ? <span className="hidden sm:inline"> dan bisa dicari</span> : " (pencarian mati)"}</p>
        </div>
        <div className="card p-3 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
              <Icon name="sparkles" size={16} />
              Belajar
            </p>
            <Badge tone={peta.belajar.aktif ? "ok" : "neutral"}>{peta.belajar.aktif ? "Aktif" : "Mati"}</Badge>
          </div>
          <div className="mt-2 flex items-center gap-1" aria-label={`${peta.belajar.giliranBaru} dari ${tiap} giliran menuju perenungan berikutnya`}>
            {Array.from({ length: tiap }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < peta.belajar.giliranBaru ? "bg-brand" : "bg-line-strong/60"}`} />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">{peta.belajar.aktif ? (sisaGiliran > 0 ? `Merenung setelah ${sisaGiliran} giliran lagi, atau saat kamu diam.` : "Siap merenung di putaran berikutnya.") : "Asisten tidak mencatat sendiri."}</p>
          <p className="mt-1 hidden text-[11px] text-muted sm:block">
            Hari ini: +{peta.hariIni.ditambah} diingat · {peta.hariIni.diperbarui} diperbarui · {peta.hariIni.dariAI} oleh AI
          </p>
        </div>
      </div>

      {/* peta + inspektur */}
      <div ref={petaRef} className="grid scroll-mt-4 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <KanvasMemori node={peta.node} sisi={peta.sisi} mode={mode} onMode={setMode} terpilih={terpilih} onPilih={pilih} sorot={sorot} />
        <Inspektur
          key={terpilih ?? "kosong"}
          n={terpilih ? node.get(terpilih) : undefined}
          sekarang={peta.sekarang}
          hubungan={terpilih ? (tetangga.get(terpilih) ?? []) : []}
          node={node}
          onPilih={setTerpilih}
          onLapor={lapor}
          jumlahMemori={memori.length}
        />
      </div>

      {pesan && (
        <p role="status" className={`rounded-xl px-3.5 py-2.5 text-sm ${pesan.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
          {pesan.teks}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* uji ingatan */}
        <Card title="Uji ingatan" icon="search">
          <p className="mb-3 text-sm text-muted">Ketik pesan seolah mau dikirim ke asisten. Lihat memori dan obrolan lama mana yang akan ikut dibawa, tanpa memanggil AI. Hasilnya menyala di peta.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              jalankanUji(String(new FormData(e.currentTarget).get("q") ?? ""));
            }}
            className="flex gap-2"
          >
            <label htmlFor="uji-q" className="sr-only">
              Pesan untuk diuji
            </label>
            <input id="uji-q" name="q" maxLength={300} placeholder="mis. gimana hemat uang makan seminggu?" className="input min-w-0 flex-1" autoComplete="off" />
            <button className="btn-secondary shrink-0" disabled={sibuk}>
              {sibuk ? "Mencari…" : "Uji"}
            </button>
          </form>
          {uji && (
            <div className="mt-4 space-y-4">
              <div>
                <p className="section-title mb-1.5">Kata kunci</p>
                {uji.hasil.kata.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {uji.hasil.kata.map((k) => (
                      <li key={k} className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: "color-mix(in srgb, #8b5cf6 16%, transparent)", color: "var(--series-6)" }}>
                        {k}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Tidak ada kata kunci yang berguna di pesan itu.</p>
                )}
              </div>
              <div>
                <p className="section-title mb-1.5">Memori yang cocok ({uji.hasil.memori.length})</p>
                {uji.hasil.memori.length ? (
                  <ul className="space-y-1.5">
                    {uji.hasil.memori.map((m) => (
                      <li key={m.id}>
                        <button type="button" onClick={() => lihatDiPeta(`m${m.id}`)} className="flex w-full items-start gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm transition hover:bg-subtle">
                          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: WARNA_NODE[m.jenis === "profil" ? "profil" : "catatan"] }} />
                          <span className="min-w-0 flex-1">
                            {m.isi}
                            <span className="mt-0.5 block text-xs text-muted">cocok: {m.cocok.join(", ")}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Tidak ada. Memori Profil &amp; Catatan selalu ikut dibawa utuh; ini hanya yang kata kuncinya cocok.</p>
                )}
              </div>
              <div>
                <p className="section-title mb-1.5">Obrolan lama yang akan disisipkan ({uji.hasil.obrolan.length})</p>
                {!ingatanAktif ? (
                  <p className="text-sm text-muted">Pencarian obrolan lama sedang dimatikan di pengaturan di bawah.</p>
                ) : uji.hasil.obrolan.length ? (
                  <ul className="space-y-1.5">
                    {uji.hasil.obrolan.map((o, i) => (
                      <li key={i} className="rounded-xl border border-line px-3 py-2 text-sm">
                        <p className="mb-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                          <span>
                            {o.umur} · {o.kanal === "web" ? "website" : "WhatsApp"}
                          </span>
                          <span className="num">skor {o.skor}</span>
                        </p>
                        {o.tanya && <p className="text-fg-2">“{o.tanya}”</p>}
                        {o.jawab && <p className="mt-0.5 text-muted">→ {o.jawab}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Tidak ada obrolan lama yang nyambung.</p>
                )}
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => (setSorot(null), setUji(null))}>
                <Icon name="x" size={14} />
                Hapus sorotan
              </button>
            </div>
          )}
        </Card>

        {/* tambah + pengaturan */}
        <div className="space-y-5">
          <Card title="Tambah ke memori" icon="plus-circle">
            <ActionForm action={ingatAction} submit="Ingat" submitClass="btn-secondary btn-sm" resetOnOk className="space-y-2.5 [&>div[role]]:basis-full">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2">
                <label htmlFor="mem-jenis" className="sr-only">
                  Jenis
                </label>
                <select id="mem-jenis" name="jenis" className="input-sm !w-auto" defaultValue="catatan">
                  <option value="profil">Profil</option>
                  <option value="catatan">Catatan</option>
                </select>
                <label htmlFor="mem-isi" className="sr-only">
                  Isi memori
                </label>
                <input id="mem-isi" name="isi" required maxLength={MAKS_ENTRI} placeholder="mis. alergi udang · kos di Indralaya" className="input-sm min-w-0" />
              </div>
            </ActionForm>
            <p className="hint">Profil = fakta tentang kamu. Catatan = kebiasaan &amp; aturan. Sandi, token, dan nomor kartu otomatis ditolak.</p>
          </Card>

          <Card title="Cara asisten belajar" icon="settings">
            <ActionForm action={simpanPengaturanMemoriAction} submit="Simpan" submitClass="btn-secondary btn-sm">
              <Saklar nama="memori_belajar" label="Belajar otomatis" ket="Asisten merenungkan obrolan di belakang layar dan mencatat yang layak diingat. Setiap catatan bisa dibatalkan di linimasa." on={peta.belajar.aktif} />
              <Saklar nama="memori_ingatan_obrolan" label="Cari di obrolan lama" ket="Sisipkan potongan obrolan lama yang nyambung ke jawaban." on={ingatanAktif} />
              <div>
                <label htmlFor="memori_refleksi_tiap" className="label">
                  Merenung setiap
                </label>
                <div className="flex items-center gap-2">
                  <input id="memori_refleksi_tiap" name="memori_refleksi_tiap" type="number" min={1} max={10} defaultValue={tiap} className="input-sm !w-20 num" />
                  <span className="text-sm text-muted">giliran obrolan</span>
                </div>
              </div>
            </ActionForm>
            <button
              type="button"
              className="btn-ghost btn-sm mt-3 w-full border border-dashed border-line-strong"
              disabled={sibuk}
              onClick={() =>
                mulaiAksi(async () => {
                  const r = await renungkanAction();
                  lapor(r.ok, r.pesan);
                })
              }
            >
              <Icon name="sparkles" size={15} />
              {sibuk ? "Merenung…" : "Renungkan sekarang"}
            </button>
          </Card>
        </div>
      </div>

      {/* penjelajah */}
      <Card title={`Semua memori (${memori.length})`} icon="brain">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Saring memori">
            {(
              [
                ["semua", "Semua"],
                ["profil", "Profil"],
                ["catatan", "Catatan"],
                ["ai", "Dicatat AI"],
                ["saya", "Dari kamu"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`chip ${filter === k ? "chip-active" : ""}`}>
                {l}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="cari-memori" className="sr-only">
              Cari memori
            </label>
            <input id="cari-memori" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari di memori…" className="input-sm sm:w-56" />
          </div>
        </div>
        {tampilMemori.length ? (
          <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {[...tampilMemori].reverse().map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => lihatDiPeta(n.id)}
                  className={`relative block w-full overflow-hidden rounded-xl border bg-card py-2.5 pl-4 pr-3 text-left transition hover:bg-subtle ${terpilih === n.id ? "border-brand ring-2 ring-[var(--ring)]" : "border-line"}`}
                >
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: WARNA_NODE[n.tipe] }} />
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: WARNA_NODE[n.tipe] }}>
                    {NAMA_TIPE[n.tipe]}
                    {n.sumber === "asisten" && <span className="rounded bg-[color-mix(in_srgb,#d946ef_16%,transparent)] px-1 text-fuchsia-500">dicatat AI</span>}
                  </span>
                  <span className="mt-0.5 block text-sm">{n.teks}</span>
                  <span className="mt-1 block text-xs text-muted">diperbarui {umur(n.diperbarui ?? n.dibuat ?? peta.sekarang, peta.sekarang)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-subtle px-3 py-3 text-sm text-muted">{memori.length ? "Tidak ada memori yang cocok dengan saringan itu." : "Belum ada memori. Ceritakan sesuatu ke asisten, atau tambahkan lewat form di atas."}</p>
        )}
      </Card>

      {/* linimasa */}
      <Card title="Linimasa memori" icon="clock">
        {peta.kejadian.length ? (
          <ol className="relative space-y-3 border-l border-line pl-5">
            {peta.kejadian.map((k) => (
              <Kejadian key={k.id} k={k} sekarang={peta.sekarang} sibuk={sibuk} onBatal={(id) => mulaiAksi(async () => lapor(...(await bataldari(id))))} />
            ))}
          </ol>
        ) : (
          <p className="rounded-xl bg-subtle px-3 py-3 text-sm text-muted">Belum ada kejadian. Setiap hal yang diingat asisten tercatat di sini.</p>
        )}
      </Card>
    </div>
  );
}

async function bataldari(id: number): Promise<[boolean, string]> {
  const r = await batalkanMemoriAction(id);
  return [r.ok, r.pesan];
}

function Kejadian({ k, sekarang, sibuk, onBatal }: { k: KejadianMemori; sekarang: string; sibuk: boolean; onBatal: (id: number) => void }) {
  const warna = k.asal === "asisten" ? "#d946ef" : "var(--brand)";
  return (
    <li className="relative">
      <span className="absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-[var(--card)]" style={{ background: warna }} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm ${k.dibatalkan ? "text-muted line-through" : ""}`}>
            <span className="font-medium">{k.asal === "asisten" ? "Asisten" : "Kamu"}</span> {k.teks}
          </p>
          <p className="text-xs text-muted">{umur(k.waktu, sekarang)}{k.dibatalkan ? " · dibatalkan" : ""}</p>
        </div>
        {k.logId !== null && (
          <button type="button" disabled={sibuk} onClick={() => onBatal(k.logId!)} className="btn-ghost btn-sm shrink-0">
            <Icon name="undo" size={14} />
            Batalkan
          </button>
        )}
      </div>
    </li>
  );
}

function Saklar({ nama, label, ket, on }: { nama: string; label: string; ket?: ReactNode; on: boolean }) {
  return (
    <label htmlFor={nama} className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" id={nama} name={nama} defaultChecked={on} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {ket && <span className="block text-xs text-muted">{ket}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- inspektur

function Inspektur({
  n,
  sekarang,
  hubungan,
  node,
  onPilih,
  onLapor,
  jumlahMemori,
}: {
  n?: NodePeta;
  sekarang: string;
  hubungan: { id: string; jenis: "kata" | "mirip"; w: number }[];
  node: Map<string, NodePeta>;
  onPilih: (id: string | null) => void;
  onLapor: (ok: boolean, teks: string) => void;
  jumlahMemori: number;
}) {
  const [ubah, setUbah] = useState(false);
  const [draf, setDraf] = useState(n?.teks ?? "");
  const [yakin, setYakin] = useState(false);
  const [sibuk, mulai] = useTransition();
  const adalahMemori = n?.tipe === "profil" || n?.tipe === "catatan";

  if (!n) {
    return (
      <aside className="card card-pad flex min-h-[200px] flex-col justify-center text-center lg:min-h-0" aria-live="polite">
        <span className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon name="sparkles" size={20} />
        </span>
        <p className="text-sm font-semibold">Pilih sebuah bintang</p>
        <p className="mx-auto mt-1 max-w-[260px] text-xs text-muted">
          Ketuk memori, topik, atau kata di peta untuk melihat isinya, apa yang terhubung dengannya, dan mengubah atau melupakannya. {jumlahMemori ? "Seret untuk menggeser, cubit atau gulir untuk zoom." : ""}
        </p>
      </aside>
    );
  }

  const memoriTerkait = hubungan.map((h) => ({ ...h, n: node.get(h.id) })).filter((h): h is typeof h & { n: NodePeta } => !!h.n);
  const kata = memoriTerkait.filter((h) => h.n.tipe === "kata" || h.n.tipe === "topik");
  const mirip = memoriTerkait.filter((h) => h.n.tipe === "profil" || h.n.tipe === "catatan").sort((a, b) => b.w - a.w);

  const simpan = () =>
    mulai(async () => {
      const r = await ubahMemoriAction(n.memoriId!, draf);
      onLapor(r.ok, r.pesan);
      if (r.ok) setUbah(false);
    });
  const lupa = () =>
    mulai(async () => {
      const f = new FormData();
      f.set("id", String(n.memoriId));
      await lupakanAction(f);
      onLapor(true, "Dilupakan.");
      onPilih(null);
    });

  return (
    <aside className="card card-pad" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: WARNA_NODE[n.tipe] }}>
          <span className="size-2 rounded-full" style={{ background: WARNA_NODE[n.tipe], boxShadow: `0 0 8px ${WARNA_NODE[n.tipe]}` }} />
          {NAMA_TIPE[n.tipe]}
        </p>
        <div className="flex items-center gap-1.5">
          {n.sumber === "asisten" && <Badge tone="brand">dicatat AI</Badge>}
          <button type="button" className="btn-ghost btn-sm !min-h-8 !px-2" onClick={() => onPilih(null)} aria-label="Tutup">
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>

      {adalahMemori ? (
        ubah ? (
          <div className="mt-2.5 space-y-2">
            <label htmlFor="ubah-memori" className="sr-only">
              Isi memori
            </label>
            <textarea id="ubah-memori" value={draf} onChange={(e) => setDraf(e.target.value)} rows={4} maxLength={MAKS_ENTRI} className="input !text-sm" />
            <p className={`num text-right text-xs ${draf.length > MAKS_ENTRI - 20 ? "text-warn" : "text-muted"}`}>
              {draf.length}/{MAKS_ENTRI}
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-sm flex-1" disabled={sibuk || !draf.trim()} onClick={simpan}>
                {sibuk ? "Menyimpan…" : "Simpan"}
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => (setUbah(false), setDraf(n.teks ?? ""))}>
                Batal
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[15px] leading-relaxed">{n.teks}</p>
        )
      ) : (
        <p className="mt-2 text-lg font-bold tracking-tight">{n.label}</p>
      )}

      <dl className="mt-3 space-y-1 text-xs text-muted">
        {adalahMemori ? (
          <>
            <div className="flex justify-between gap-2">
              <dt>Dibuat</dt>
              <dd>{umur(n.dibuat ?? sekarang, sekarang)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Diperbarui</dt>
              <dd>{umur(n.diperbarui ?? sekarang, sekarang)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Panjang</dt>
              <dd className="num">{n.teks?.length ?? 0} karakter</dd>
            </div>
          </>
        ) : (
          <div className="flex justify-between gap-2">
            <dt>{n.tipe === "topik" ? "Muncul di obrolan" : "Dimuat di"}</dt>
            <dd className="num">{n.jumlah} {n.tipe === "topik" ? "pesan" : "memori"}</dd>
          </div>
        )}
      </dl>

      {kata.length > 0 && (
        <div className="mt-3.5">
          <p className="section-title mb-1.5">Kata terhubung</p>
          <ul className="flex flex-wrap gap-1.5">
            {kata.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => onPilih(h.id)} className="rounded-full px-2.5 py-0.5 text-xs font-medium transition hover:brightness-110" style={{ background: `color-mix(in srgb, ${WARNA_NODE[h.n.tipe]} 18%, transparent)`, color: h.n.tipe === "topik" ? "var(--series-6)" : "var(--brand)" }}>
                  {h.n.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mirip.length > 0 && (
        <div className="mt-3.5">
          <p className="section-title mb-1.5">{adalahMemori ? "Memori yang mirip" : "Memori terkait"}</p>
          <ul className="space-y-1.5">
            {mirip.slice(0, 5).map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => onPilih(h.id)} className="flex w-full items-start gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-[13px] transition hover:bg-subtle">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: WARNA_NODE[h.n.tipe] }} />
                  <span className="min-w-0">{h.n.teks}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {adalahMemori && !ubah && (
        <div className="mt-4 flex gap-2 border-t border-line pt-3.5">
          <button type="button" className="btn-secondary btn-sm flex-1" onClick={() => setUbah(true)}>
            <Icon name="pencil" size={14} />
            Ubah
          </button>
          {yakin ? (
            <button type="button" className="btn-danger btn-sm flex-1" disabled={sibuk} onClick={lupa}>
              {sibuk ? "…" : "Yakin lupakan?"}
            </button>
          ) : (
            <button type="button" className="btn-ghost btn-sm flex-1 text-bad" onClick={() => (setYakin(true), window.setTimeout(() => setYakin(false), 4000))}>
              <Icon name="trash" size={14} />
              Lupakan
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
