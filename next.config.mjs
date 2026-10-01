const produksi = process.env.NODE_ENV === "production";
const https = process.env.COOKIE_SECURE === "1";

// Semua aset dari server sendiri; tidak ada skrip/gaya pihak ketiga. Next.js butuh 'unsafe-inline' untuk
// skrip hidrasinya (tanpa nonce), dan 'unsafe-eval' hanya saat development.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${produksi ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(https ? ["upgrade-insecure-requests"] : []),
].join("; ");

const headerKeamanan = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "qrcode", "exceljs", "tesseract.js"],
  poweredByHeader: false,
  experimental: {
    // foto struk dari HP bisa beberapa MB
    serverActions: { bodySizeLimit: "10mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: headerKeamanan },
      // data pribadi: jangan pernah disimpan cache browser/proxy
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // service worker harus selalu dicek versi terbarunya
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
