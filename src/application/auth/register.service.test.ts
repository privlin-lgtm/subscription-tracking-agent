import { describe, expect, it, vi } from "vitest";
import { RegisterService } from "@/application/auth/register.service";
import { ConflictError, ValidationError } from "@/domain/errors";
import type { UserRepository } from "@/domain/repositories";

function users(existing: { id: string; email: string; passwordHash: string | null } | null = null): UserRepository {
  return {
    findByEmail: vi.fn(async () => existing),
    findById: vi.fn(),
    create: vi.fn(async (email) => ({ id: "user_1", email })),
    findOrCreateByEmail: vi.fn(),
    updateGmailConnection: vi.fn(),
    updateHistoryId: vi.fn(),
    listConnectedUserIds: vi.fn(async () => []),
  };
}

describe("RegisterService", () => {
  it("creates an account with a normalized email", async () => {
    const repo = users();
    const service = new RegisterService(repo);
    const created = await service.register("  Paul@Example.com ", "super-secret-password");
    expect(created.email).toBe("paul@example.com");
    expect(repo.create).toHaveBeenCalled();
  });

  it("rejects invalid emails and short passwords", async () => {
    const service = new RegisterService(users());
    await expect(service.register("not-an-email", "super-secret-password")).rejects.toBeInstanceOf(ValidationError);
    await expect(service.register("paul@example.com", "short")).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a duplicate email", async () => {
    const service = new RegisterService(users({ id: "user_1", email: "paul@example.com", passwordHash: "x" }));
    await expect(service.register("paul@example.com", "super-secret-password")).rejects.toBeInstanceOf(ConflictError);
  });
});
