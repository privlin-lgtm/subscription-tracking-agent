import { isIso4217 } from "@/shared/iso-4217";
import { ValidationError } from "@/domain/errors";

export function normalizeCurrency(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!isIso4217(code)) {
    throw new ValidationError(`Invalid ISO 4217 currency: ${raw}`);
  }
  return code;
}

export function tryNormalizeCurrency(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const code = raw.trim().toUpperCase();
  return isIso4217(code) ? code : null;
}
