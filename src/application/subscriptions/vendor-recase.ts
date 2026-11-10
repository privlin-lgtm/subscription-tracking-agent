import { EventType } from "@prisma/client";
import type { SubscriptionRecord, SubscriptionRepository } from "@/domain/repositories";
import {
  normalizeVendorKey,
  titleCaseVendor,
  vendorDisplayName,
  vendorMatchKey,
} from "@/domain/value-objects/vendor-name";

export type VendorRecaseRow = Pick<SubscriptionRecord, "id" | "userId" | "vendorRaw" | "vendorNormalized">;

export type VendorRecaseChange = {
  id: string;
  userId: string;
  vendorRaw: string;
  from: string;
  to: string;
};

/** The name the app stored for a non-catalogue vendor before casing was kept. */
export function legacyVendorDisplayName(vendorRaw: string): string {
  return titleCaseVendor(normalizeVendorKey(vendorRaw) || vendorRaw);
}

/**
 * Which stored vendor names should be rewritten with the casing they were typed in.
 *
 * A row is changed only when all of these hold, so nothing a person or the catalogue chose is
 * overwritten:
 * - its stored name is exactly what the old title-casing rule made from `vendorRaw` (so it was
 *   not edited in the review queue and is not an email sender held for review);
 * - its stored name is not a catalogue (alias table) name;
 * - the new name differs, and is still the same vendor for duplicate matching.
 */
export function planVendorRecase(rows: VendorRecaseRow[], canonicalNames: string[]): VendorRecaseChange[] {
  const canonical = new Set(canonicalNames);
  const changes: VendorRecaseChange[] = [];
  for (const row of rows) {
    if (canonical.has(row.vendorNormalized) || row.vendorNormalized !== legacyVendorDisplayName(row.vendorRaw)) {
      continue;
    }
    const to = vendorDisplayName(row.vendorRaw);
    if (to === row.vendorNormalized || vendorMatchKey(to) !== vendorMatchKey(row.vendorNormalized)) {
      continue;
    }
    changes.push({ id: row.id, userId: row.userId, vendorRaw: row.vendorRaw, from: row.vendorNormalized, to });
  }
  return changes;
}

/**
 * Applies a recase plan. Each row goes through the repository's transactional `applyWrite`,
 * like every other subscription change, so it leaves an UPDATED event and an audit entry.
 * With `dryRun` nothing is written; the plan is returned either way.
 */
export async function recaseVendorNames(
  subscriptions: Pick<SubscriptionRepository, "applyWrite">,
  rows: VendorRecaseRow[],
  canonicalNames: string[],
  options: { dryRun: boolean },
): Promise<VendorRecaseChange[]> {
  const changes = planVendorRecase(rows, canonicalNames);
  if (options.dryRun) {
    return changes;
  }
  for (const change of changes) {
    await subscriptions.applyWrite({
      update: { id: change.id, data: { vendorNormalized: change.to } },
      events: [
        {
          eventType: EventType.UPDATED,
          payload: { vendorNormalized: change.to, previousVendorNormalized: change.from, source: "vendor-recase" },
        },
      ],
      audit: {
        userId: change.userId,
        action: "subscription.vendor_recase",
        actor: "system",
        details: { subscriptionId: change.id, from: change.from, to: change.to },
      },
    });
  }
  return changes;
}
