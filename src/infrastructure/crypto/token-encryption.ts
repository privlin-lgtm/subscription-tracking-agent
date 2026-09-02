import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { ValidationError } from "@/domain/errors";
import type { TokenEncryptor } from "@/domain/ports";

const PREFIX = "v1";

export class AesGcmTokenEncryptor implements TokenEncryptor {
  constructor(private readonly secret: string) {}

  encrypt(plaintext: string): string {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [PREFIX, iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
  }

  decrypt(ciphertext: string): string {
    const [version, ivHex, tagHex, dataHex] = ciphertext.split(":");
    if (version !== PREFIX || !ivHex || !tagHex || !dataHex) {
      throw new ValidationError("Invalid encrypted token format");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return decrypted.toString("utf8");
  }

  private key(): Buffer {
    if (!this.secret || this.secret.length < 16) {
      throw new ValidationError("TOKEN_ENCRYPTION_KEY is not configured");
    }
    return scryptSync(this.secret, "subscription-tracker-tokens", 32);
  }
}
