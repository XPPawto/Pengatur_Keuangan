/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "qrcode"],
  poweredByHeader: false,
};

export default nextConfig;
