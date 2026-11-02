// Prisma 7 no longer reads the connection URL or seed command from schema.prisma /
// package.json, and no longer loads .env on its own, so both live here.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Read directly (not via `env()`) so `prisma generate` (run on postinstall) still
    // works on machines/CI with no DATABASE_URL set. Migrate/seed fail loudly without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
