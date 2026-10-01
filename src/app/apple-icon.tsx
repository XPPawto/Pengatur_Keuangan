import { ikonPng } from "@/lib/pwa/gambar";

// Ikon Layar Utama iPhone (iOS tidak memakai ikon SVG).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return ikonPng(180, 0.74);
}
