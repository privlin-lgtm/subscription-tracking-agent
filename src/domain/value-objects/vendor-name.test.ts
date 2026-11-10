import { describe, expect, it } from "vitest";
import { diceCoefficient, normalizeVendorKey, vendorDisplayName, vendorMatchKey } from "@/domain/value-objects/vendor-name";

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

describe("vendor display name keeps the casing it was written in", () => {
  it("keeps a mixed-case name exactly as written", () => {
    expect(vendorDisplayName("XPlace")).toBe("XPlace");
    expect(vendorDisplayName("WalkFit")).toBe("WalkFit");
    expect(vendorDisplayName("Apple TV")).toBe("Apple TV");
    expect(vendorDisplayName("iHerb")).toBe("iHerb");
    expect(vendorDisplayName("Disney+")).toBe("Disney+");
    expect(vendorDisplayName("Zebra-Fitness Club")).toBe("Zebra-Fitness Club");
  });

  it("trims and collapses spaces", () => {
    expect(vendorDisplayName("  Apple   TV \t")).toBe("Apple TV");
  });

  it("title-cases a name written all in lower case", () => {
    expect(vendorDisplayName("netflix")).toBe("Netflix");
    expect(vendorDisplayName("zebra fitness club")).toBe("Zebra Fitness Club");
  });

  it("title-cases a name written all in upper case", () => {
    expect(vendorDisplayName("NETFLIX.COM")).toBe("Netflix Com");
    expect(vendorDisplayName("SPOTIFY AB")).toBe("Spotify Ab");
    // Known limit: a bare acronym cannot be told apart from a shouting sender.
    expect(vendorDisplayName("HBO")).toBe("Hbo");
  });

  it("drops a web address prefix", () => {
    expect(vendorDisplayName("https://www.XPlace.com")).toBe("XPlace.com");
    expect(vendorDisplayName("https://www.spotify.com")).toBe("Spotify Com");
  });

  it("keeps names with no cased letters, or with non-ASCII letters, as written", () => {
    expect(vendorDisplayName("יס פלוס")).toBe("יס פלוס");
    expect(vendorDisplayName("yes פלוס")).toBe("yes פלוס");
    expect(vendorDisplayName("1234")).toBe("1234");
    expect(vendorDisplayName("CAFÉ NOIR")).toBe("CAFÉ NOIR");
  });
});

describe("vendor match key", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(vendorMatchKey("XPlace")).toBe(vendorMatchKey("Xplace"));
    expect(vendorMatchKey("X-Place")).not.toBe(vendorMatchKey("XPlace"));
    expect(vendorMatchKey("Zebra-Fitness  Club")).toBe(vendorMatchKey("zebra fitness club"));
    expect(vendorMatchKey("https://www.XPlace.com")).toBe(vendorMatchKey("Xplace Com"));
  });

  it("equals normalizeVendorKey for plain ASCII names", () => {
    for (const name of ["NETFLIX.COM", "https://www.Spotify.com", "iCloud+", "Apple TV", "Zebra-Fitness Club"]) {
      expect(vendorMatchKey(name)).toBe(normalizeVendorKey(name));
    }
  });

  it("keeps different non-Latin names apart", () => {
    expect(normalizeVendorKey("יס פלוס")).toBe("");
    expect(vendorMatchKey("יס פלוס")).not.toBe(vendorMatchKey("הוט מובייל"));
    expect(vendorMatchKey("יס פלוס")).toBe("יס פלוס");
  });
});
