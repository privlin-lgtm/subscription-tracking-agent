import bcrypt from "bcryptjs";
import { ConflictError, ValidationError } from "@/domain/errors";
import type { UserRepository } from "@/domain/repositories";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class RegisterService {
  constructor(private readonly users: UserRepository) {}

  async register(email: string, password: string): Promise<{ id: string; email: string }> {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      throw new ValidationError("Invalid email");
    }
    if (password.length < 10) {
      throw new ValidationError("Password must be at least 10 characters");
    }
    const existing = await this.users.findByEmail(normalized);
    if (existing) {
      throw new ConflictError("An account with that email already exists");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    return this.users.create(normalized, passwordHash);
  }
}
