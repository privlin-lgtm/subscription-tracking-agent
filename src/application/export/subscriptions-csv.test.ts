import { BillingCycle, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { SubscriptionRecord } from "@/domain/repositories";
import {
  buildSubscriptionsCsv,
  CSV_BOM,
  escapeCsvField,
  neutralizeFormula,
} from "@/application/export/subscriptions-csv";

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub_1",
    userId: "user_1",
    vendorNormalized: "Netflix",
    vendorRaw: "netflix",
    status: SubscriptionStatus.ACTIVE,
    priceAmountCents: 1599,
    priceCurrency: "USD",
    billingCycle: BillingCycle.MONTHLY,
    nextRenewalDate: new Date("2026-11-15T00:00:00.000Z"),
    lastSeenEmailId: null,
    confidenceScore: 1,
    reviewReason: null,
    createdAt: new Date("2026-01-02T10:00:00.000Z"),
    updatedAt: new Date("2026-10-03T10:00:00.000Z"),
    ...overrides,
  };
}

/** Minimal RFC 4180 reader, so the tests check what a spreadsheet would actually read back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r" && text[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }
  return rows;
}

describe("buildSubscriptionsCsv", () => {
  it("writes a BOM, a header row and one CRLF-terminated row per subscription", () => {
    const csv = buildSubscriptionsCsv([subscription()]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(parseCsv(csv.slice(1))).toEqual([
      ["Vendor", "Status", "Price", "Currency", "Billing cycle", "Next renewal", "First tracked", "Last updated"],
      ["Netflix", "ACTIVE", "15.99", "USD", "MONTHLY", "2026-11-15", "2026-01-02", "2026-10-03"],
    ]);
  });

  it("round-trips commas, quotes and line breaks in vendor names", () => {
    const vendor = 'Acme, Inc. "Pro"\nplan';
    const rows = parseCsv(buildSubscriptionsCsv([subscription({ vendorNormalized: vendor })]).slice(1));
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe(vendor);
    expect(rows[1]).toHaveLength(8);
  });

  it.each(["=HYPERLINK(\"http://evil\",\"x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1"])(
    "neutralises the formula-starting vendor %j",
    (vendor) => {
      const rows = parseCsv(buildSubscriptionsCsv([subscription({ vendorNormalized: vendor })]).slice(1));
      expect(rows[1][0]).toBe(`'${vendor}`);
      expect(rows[1]).toHaveLength(8);
    },
  );

  it("leaves ordinary text and mid-string symbols alone", () => {
    expect(neutralizeFormula("Disney+")).toBe("Disney+");
    expect(neutralizeFormula("A=B")).toBe("A=B");
    expect(neutralizeFormula("")).toBe("");
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("uses each currency's own decimals and leaves a missing renewal date empty", () => {
    const rows = parseCsv(
      buildSubscriptionsCsv([
        subscription({ id: "a", vendorNormalized: "Aaa", priceAmountCents: 1500, priceCurrency: "JPY", nextRenewalDate: null }),
        subscription({ id: "b", vendorNormalized: "Bbb", priceAmountCents: 1234, priceCurrency: "KWD" }),
      ]).slice(1),
    );
    expect(rows[1].slice(0, 6)).toEqual(["Aaa", "ACTIVE", "1500", "JPY", "MONTHLY", ""]);
    expect(rows[2].slice(2, 4)).toEqual(["1.234", "KWD"]);
  });

  it("sorts by vendor and returns only the header for an empty list", () => {
    const rows = parseCsv(
      buildSubscriptionsCsv([
        subscription({ id: "2", vendorNormalized: "Spotify" }),
        subscription({ id: "1", vendorNormalized: "Adobe" }),
      ]).slice(1),
    );
    expect(rows.slice(1).map((row) => row[0])).toEqual(["Adobe", "Spotify"]);
    expect(parseCsv(buildSubscriptionsCsv([]).slice(1))).toHaveLength(1);
  });
});
