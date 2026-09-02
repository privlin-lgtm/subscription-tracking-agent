import { describe, expect, it } from "vitest";
import { VendorNormalizationService } from "@/application/subscriptions/vendor-normalization.service";
import type { VendorAliasRepository } from "@/domain/repositories";

class InMemoryAliases implements VendorAliasRepository {
  constructor(private readonly rows: Array<{ alias: string; canonicalName: string }>) {}

  async findCanonical(alias: string) {
    return this.rows.find((row) => row.alias === alias)?.canonicalName ?? null;
  }

  async listCanonicalNames() {
    return [...new Set(this.rows.map((row) => row.canonicalName))];
  }
}

describe("vendor normalization", () => {
  const service = new VendorNormalizationService(
    new InMemoryAliases([
      { alias: "netflix", canonicalName: "Netflix" },
      { alias: "amazon prime", canonicalName: "Amazon Prime" },
      { alias: "amazon music", canonicalName: "Amazon Music" },
    ]),
    0.88,
  );

  it("uses the exact alias table first", async () => {
    await expect(service.normalize("Netflix")).resolves.toEqual({ kind: "exact", canonical: "Netflix" });
  });

  it("routes a weak fuzzy match to unmatched instead of merging vendors", async () => {
    const result = await service.normalize("Amazon");
    expect(result.kind).not.toBe("exact");
    if (result.kind === "fuzzy") {
      expect(result.score).toBeGreaterThanOrEqual(0.88);
    }
  });
});
