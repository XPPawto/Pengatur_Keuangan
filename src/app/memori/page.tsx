import Link from "next/link";
import RuangMemori from "@/components/memori/RuangMemori";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { bangunPetaMemori } from "@/lib/ai/petaMemori";
import { getSetting, getSettingNumber } from "@/lib/services/settings";

export const metadata = { title: "Memori AI" };
export const dynamic = "force-dynamic";

export default async function MemoriPage() {
  const now = new Date();
  const tiap = Math.min(10, Math.max(1, (await getSettingNumber(prisma, "memori_refleksi_tiap")) || 3));
  const [peta, ingatanAktif] = await Promise.all([bangunPetaMemori(prisma, now, tiap), getSetting(prisma, "memori_ingatan_obrolan")]);
  return (
    <div className="space-y-5">
      <PageHeader
        title="Memori AI"
        subtitle="Apa yang diingat asisten tentang kamu: profil, catatan, dan obrolan lama. Semuanya ada di server kamu sendiri."
        actions={
          <Link href="/asisten" className="btn-secondary btn-sm">
            <Icon name="bot" size={15} />
            Ngobrol dengan asisten
          </Link>
        }
      />
      <RuangMemori peta={peta} ingatanAktif={ingatanAktif === "1"} tiap={tiap} />
    </div>
  );
}
