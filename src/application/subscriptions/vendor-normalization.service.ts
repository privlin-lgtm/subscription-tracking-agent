import { BillingCycle } from "@prisma/client";
import { diceCoefficient, normalizeVendorKey, titleCaseVendor } from "@/domain/value-objects/vendor-name";
import type { VendorAliasRepository } from "@/domain/repositories";

export type VendorNormalization =
  | { kind: "exact"; canonical: string }
  | { kind: "fuzzy"; canonical: string; score: number }
  | { kind: "unmatched"; canonical: string };

export class VendorNormalizationService {
  constructor(
    private readonly aliases: VendorAliasRepository,
    private readonly fuzzyThreshold: number,
  ) {}

  async normalize(rawVendor: string): Promise<VendorNormalization> {
    const key = normalizeVendorKey(rawVendor);
    const exact = await this.aliases.findCanonical(key);
    if (exact) {
      return { kind: "exact", canonical: exact };
    }

    const canonicalNames = await this.aliases.listCanonicalNames();
    let best: { name: string; score: number } | null = null;
    for (const name of canonicalNames) {
      const score = diceCoefficient(key, name);
      if (!best || score > best.score) {
        best = { name, score };
      }
    }

    if (best && best.score >= this.fuzzyThreshold) {
      return { kind: "fuzzy", canonical: best.name, score: best.score };
    }

    return { kind: "unmatched", canonical: titleCaseVendor(key || rawVendor) };
  }
}

export function toBillingCycle(value: ExtractionBillingCycle): BillingCycle {
  switch (value) {
    case "weekly":
      return BillingCycle.WEEKLY;
    case "monthly":
      return BillingCycle.MONTHLY;
    case "annual":
      return BillingCycle.ANNUAL;
    default:
      return BillingCycle.CUSTOM;
  }
}

type ExtractionBillingCycle = "weekly" | "monthly" | "annual" | "custom" | "unknown";
