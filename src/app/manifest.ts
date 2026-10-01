import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DompetKos",
    short_name: "DompetKos",
    description: "Budget mingguan sistem amplop + asisten",
    lang: "id",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7f9",
    theme_color: "#0f766e",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      { name: "Catat pengeluaran", short_name: "Catat", url: "/catat", icons: [{ src: "/icons/192", sizes: "192x192" }] },
      { name: "Asisten AI", short_name: "Asisten", url: "/asisten", icons: [{ src: "/icons/192", sizes: "192x192" }] },
    ],
  };
}
