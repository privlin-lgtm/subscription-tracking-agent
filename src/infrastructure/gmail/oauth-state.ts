import { createHmac, timingSafeEqual } from "node:crypto";
import { ValidationError } from "@/domain/errors";

const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthStatePayload = {
  userId: string;
  nonce: string;
  exp: number;
};

export function signOAuthState(
  userId: string,
  secret: string,
  now = Date.now(),
  nonce = crypto.randomUUID(),
): string {
  const payload: OAuthStatePayload = { userId, nonce, exp: now + STATE_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyOAuthState(
  state: string,
  expectedUserId: string,
  secret: string,
  now = Date.now(),
): OAuthStatePayload {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    throw new ValidationError("Invalid OAuth state");
  }
  const expected = sign(encoded, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new ValidationError("Invalid OAuth state signature");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
  if (payload.userId !== expectedUserId) {
    throw new ValidationError("OAuth state does not match the signed-in user");
  }
  if (payload.exp < now) {
    throw new ValidationError("OAuth state expired");
  }
  return payload;
}

function sign(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}
