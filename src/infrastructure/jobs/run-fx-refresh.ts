// One-off manual run of the daily FX rate job: `npm run fx:refresh`.
// Standalone process, so (like worker.ts) it loads .env itself.
import "dotenv/config";
import { createApp } from "@/infrastructure/composition";
import { prisma } from "@/infrastructure/db/prisma";

async function main(): Promise<void> {
  const result = await createApp().fxRateJob.run();
  console.log(
    `Stored ${result.stored} of ${result.requested.length} rates against ${result.base}` +
      (result.missing.length > 0 ? `; no rate for: ${result.missing.join(", ")}` : ""),
  );
}

main()
  .catch((error: unknown) => {
    // Node's fetch reports network trouble as a bare "fetch failed"; the useful part
    // (DNS, refused, timeout) is on error.cause.
    const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : "";
    console.error(`FX rate refresh failed: ${error instanceof Error ? error.message : "unknown"}${cause}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
