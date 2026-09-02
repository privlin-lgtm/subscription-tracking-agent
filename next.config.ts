import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "@prisma/client", "bcryptjs"],
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
