import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "qrcode"],
  poweredByHeader: false,
};

export default nextConfig;
