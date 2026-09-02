import { describe, expect, it } from "vitest";
import { diceCoefficient, normalizeVendorKey } from "@/domain/value-objects/vendor-name";

describe("vendor name", () => {
  it("normalizes punctuation and case", () => {
    expect(normalizeVendorKey("NETFLIX.COM")).toBe("netflix com");
    expect(normalizeVendorKey("https://www.Spotify.com")).toBe("spotify com");
  });

  it("scores exact names as 1", () => {
    expect(diceCoefficient("Netflix", "netflix")).toBe(1);
  });

  it("scores similar names higher than unrelated ones", () => {
    expect(diceCoefficient("Netflix", "Netflx")).toBeGreaterThan(diceCoefficient("Netflix", "Spotify"));
  });
});
