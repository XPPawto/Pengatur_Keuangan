/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "qrcode", "exceljs", "tesseract.js"],
  poweredByHeader: false,
  experimental: {
    // foto struk dari HP bisa beberapa MB
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
