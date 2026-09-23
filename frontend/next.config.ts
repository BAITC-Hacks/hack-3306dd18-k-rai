import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Статический экспорт: сборка кладёт всё в out/, бэкенд раздаёт эту папку.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
