import { BillingCycle } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildRenewalsIcs,
  escapeIcsText,
  foldIcsLine,
  renewalUid,
} from "@/application/export/renewals-ics";
import type { RenewalOccurrence } from "@/application/subscriptions/renewal-calendar";
import { parseIcs } from "@/test/ics-parser";

const NOW = new Date("2026-11-09T22:30:00.000Z");

function occurrence(overrides: Partial<RenewalOccurrence> = {}): RenewalOccurrence {
  return {
    subscriptionId: "sub_1",
    vendor: "Netflix",
    dateKey: "2026-11-15",
    amountCents: 1599,
    currency: "USD",
    billingCycle: BillingCycle.MONTHLY,
    projected: false,
    ...overrides,
  };
}

describe("buildRenewalsIcs", () => {
  it("parses back into one all-day event per renewal", () => {
    const ics = buildRenewalsIcs(
      [
        occurrence(),
        occurrence({ dateKey: "2026-12-15", projected: true }),
        occurrence({ subscriptionId: "sub_2", vendor: "Spotify", dateKey: "2026-12-31", amountCents: 999, currency: "EUR" }),
      ],
      { now: NOW },
    );
    const calendar = parseIcs(ics);

    expect(calendar.properties).toMatchObject({
      VERSION: "2.0",
      PRODID: "-//Subscription Tracker//Renewals//EN",
      CALSCALE: "GREGORIAN",
      METHOD: "PUBLISH",
      "X-WR-CALNAME": "Subscription renewals",
    });
    expect(calendar.events).toHaveLength(3);

    const [first, second, third] = calendar.events;
    expect(first).toMatchObject({
      UID: "renewal-sub_1-20261115@subscription-tracker.local",
      DTSTAMP: "20261109T223000Z",
      "DTSTART;VALUE=DATE": "20261115",
      "DTEND;VALUE=DATE": "20261116",
      SUMMARY: "Netflix renews (15.99 USD)",
      TRANSP: "TRANSPARENT",
    });
    expect(first.DESCRIPTION).toBe(
      "Netflix renews for 15.99 USD (monthly).\nRenewal date on record in Subscription Tracker.",
    );
    expect(second.DESCRIPTION).toContain("Estimated from the billing cycle");
    // An all-day event on 31 December ends (exclusively) on 1 January.
    expect(third["DTSTART;VALUE=DATE"]).toBe("20261231");
    expect(third["DTEND;VALUE=DATE"]).toBe("20270101");
    expect(third.SUMMARY).toBe("Spotify renews (9.99 EUR)");
  });

  it("uses CRLF line endings and keeps every line within 75 octets", () => {
    const ics = buildRenewalsIcs(
      [occurrence({ vendor: "Ünïcödé Stréaming Sérvice with a very long name — ".repeat(4) })],
      { now: NOW },
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(parseIcs(ics).events[0].SUMMARY).toBe(
      `${"Ünïcödé Stréaming Sérvice with a very long name — ".repeat(4)} renews (15.99 USD)`,
    );
  });

  it("gives the same UID on every download and a different one per day and subscription", () => {
    const first = parseIcs(buildRenewalsIcs([occurrence()], { now: NOW }));
    const later = parseIcs(buildRenewalsIcs([occurrence()], { now: new Date("2027-01-01T00:00:00.000Z") }));
    expect(first.events[0].UID).toBe(later.events[0].UID);
    expect(renewalUid(occurrence({ dateKey: "2026-12-15" }))).not.toBe(renewalUid(occurrence()));
    expect(renewalUid(occurrence({ subscriptionId: "sub_2" }))).not.toBe(renewalUid(occurrence()));
    expect(renewalUid(occurrence({ subscriptionId: "a\r\nb@c" }))).toBe("renewal-abc-20261115@subscription-tracker.local");
  });

  it("cannot be made to emit extra properties or events through a vendor name", () => {
    const vendor = "Evil\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:injected;x=1,2\\";
    const ics = buildRenewalsIcs([occurrence({ vendor })], { now: NOW });
    const calendar = parseIcs(ics);
    expect(calendar.events).toHaveLength(1);
    // The injected text stays inside the SUMMARY value: only one content line opens an event.
    const contentLines = ics.replace(/\r\n[ \t]/g, "").split("\r\n");
    expect(contentLines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(contentLines.filter((line) => line.startsWith("SUMMARY:"))).toHaveLength(1);
    expect(calendar.events[0].SUMMARY).toBe(
      "Evil\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:injected;x=1,2\\ renews (15.99 USD)",
    );
  });

  it("returns a valid empty calendar when there are no renewals", () => {
    const calendar = parseIcs(buildRenewalsIcs([], { now: NOW, calendarName: "Mine; all" }));
    expect(calendar.events).toEqual([]);
    expect(calendar.properties["X-WR-CALNAME"]).toBe("Mine; all");
  });
});

describe("ICS text helpers", () => {
  it("escapes backslash, semicolon, comma and line breaks, and drops control characters", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf\u0007g")).toBe(String.raw`a\\b\;c\,d\ne\nfg`);
  });

  it("leaves short lines alone and folds long ones with a leading space", () => {
    expect(foldIcsLine("SUMMARY:short")).toBe("SUMMARY:short");
    const folded = foldIcsLine(`SUMMARY:${"x".repeat(200)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toHaveLength(75);
    expect(lines.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(lines.map((line, index) => (index === 0 ? line : line.slice(1))).join("")).toBe(`SUMMARY:${"x".repeat(200)}`);
  });
});
