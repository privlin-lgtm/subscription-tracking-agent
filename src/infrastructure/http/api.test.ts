import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/infrastructure/auth/auth", () => ({ auth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const { jsonError } = await import("@/infrastructure/http/api");

describe("jsonError with zod validation errors", () => {
  it("maps a ZodError to a 400 with the first issue's message", async () => {
    const schema = z.object({ email: z.email(), password: z.string().min(10) });
    const result = schema.safeParse({ email: "not-an-email", password: "short" });
    expect(result.success).toBe(false);

    const response = jsonError(result.error);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.error).not.toBe("Internal server error");
  });

  it("does not echo the rejected value back in the message", async () => {
    const secret = "hunter2-should-not-leak";
    const result = z.object({ amount: z.number() }).safeParse({ amount: secret });
    const body = (await jsonError(result.error).json()) as { error: string };
    expect(body.error).not.toContain(secret);
  });
});
