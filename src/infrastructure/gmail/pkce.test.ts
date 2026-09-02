import { describe, expect, it } from "vitest";
import { generatePkce } from "@/infrastructure/gmail/pkce";

describe("PKCE", () => {
  it("returns a verifier and a matching SHA-256 challenge", () => {
    const pair = generatePkce();
    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pair.verifier).not.toBe(pair.challenge);
  });
});
