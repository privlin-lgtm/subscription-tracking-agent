// One-off: rewrite stored vendor names with the casing they were typed in
// ("Xplace" -> "XPlace"). Names used to be title-cased when saved.
//
//   npm run vendors:recase -- --dry-run   prints each change, writes nothing
//   npm run vendors:recase -- --apply     makes the changes (event + audit entry per row)
//
// Standalone process, so (like run-fx-refresh.ts) it loads .env itself.
import "dotenv/config";
import { recaseVendorNames } from "@/application/subscriptions/vendor-recase";
import { PrismaSubscriptionRepository, PrismaVendorAliasRepository } from "@/infrastructure/db/repositories";
import { prisma } from "@/infrastructure/db/prisma";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (dryRun === apply || args.some((arg) => arg !== "--dry-run" && arg !== "--apply")) {
    console.error("Usage: npm run vendors:recase -- --dry-run   (or --apply to make the changes)");
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.subscription.findMany({
    select: { id: true, userId: true, vendorRaw: true, vendorNormalized: true },
    orderBy: [{ userId: "asc" }, { vendorNormalized: "asc" }],
  });
  const canonicalNames = await new PrismaVendorAliasRepository().listCanonicalNames();
  const changes = await recaseVendorNames(new PrismaSubscriptionRepository(), rows, canonicalNames, { dryRun });

  for (const change of changes) {
    console.log(`${dryRun ? "would change" : "changed"}  "${change.from}" -> "${change.to}"  (subscription ${change.id})`);
  }
  console.log(
    `${dryRun ? "Dry run: " : ""}${changes.length} of ${rows.length} subscriptions ${dryRun ? "would be" : "were"} renamed.` +
      (dryRun && changes.length > 0 ? " Run again with --apply to make these changes." : ""),
  );
}

main()
  .catch((error: unknown) => {
    console.error(`Vendor recase failed: ${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
