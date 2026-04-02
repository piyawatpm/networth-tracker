import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["echarts", "zrender", "xlsx"],
};

export default nextConfig;
