import { ValidationError } from "@/domain/errors";
import { isIso4217 } from "@/shared/iso-4217";

const MINOR_UNITS_BY_CURRENCY: Record<string, number> = {
  BHD: 1000,
  JPY: 1,
  KWD: 1000,
  KRW: 1,
};

export function minorUnitsFor(currency: string): number {
  return MINOR_UNITS_BY_CURRENCY[currency.toUpperCase()] ?? 100;
}

export function majorToMinorUnits(amount: number, currency: string): number {
  const factor = minorUnitsFor(currency);
  return Math.round(amount * factor);
}

export function minorToMajorUnits(cents: number, currency: string): number {
  return cents / minorUnitsFor(currency);
}

export class Money {
  readonly amountCents: number;
  readonly currency: string;

  constructor(amountCents: number, currency: string) {
    if (!Number.isInteger(amountCents) || amountCents < 0) {
      throw new ValidationError("Money amount must be a non-negative integer in minor units");
    }
    const normalized = currency.toUpperCase();
    if (!isIso4217(normalized)) {
      throw new ValidationError(`Unsupported currency: ${currency}`);
    }
    this.amountCents = amountCents;
    this.currency = normalized;
  }

  static fromMajor(amount: number, currency: string): Money {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Price amount must be a positive number");
    }
    return new Money(majorToMinorUnits(amount, currency), currency);
  }

  equals(other: Money): boolean {
    return this.amountCents === other.amountCents && this.currency === other.currency;
  }

  approximatelyEquals(other: Money, toleranceRatio = 0.05): boolean {
    if (this.currency !== other.currency) {
      return false;
    }
    const delta = Math.abs(this.amountCents - other.amountCents);
    const baseline = Math.max(this.amountCents, other.amountCents, 1);
    return delta / baseline <= toleranceRatio;
  }
}
