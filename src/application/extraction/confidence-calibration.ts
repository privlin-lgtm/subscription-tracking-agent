import { KNOWN_BILLING_DOMAINS } from "@/shared/constants";
import { isIso4217 } from "@/shared/iso-4217";
import type { ExtractionResult } from "@/domain/ports";

export type CalibrationSignals = {
  sender: string;
  knownVendorMatch: boolean;
};

export function calibrateConfidence(
  extraction: ExtractionResult,
  signals: CalibrationSignals,
  autoApplyThreshold: number,
): { confidence: number; reviewReason: string | null } {
  let confidence = extraction.confidence;
  const reasons: string[] = [];

  if (KNOWN_BILLING_DOMAINS.some((domain) => signals.sender.toLowerCase().includes(domain))) {
    confidence = Math.min(1, confidence + 0.08);
  }
  if (signals.knownVendorMatch) {
    confidence = Math.min(1, confidence + 0.05);
  }

  if (!isIso4217(extraction.currency)) {
    confidence = Math.min(confidence, autoApplyThreshold - 0.01);
    reasons.push("currency_not_iso_4217");
  }
  if (!(extraction.priceAmount > 0)) {
    confidence = Math.min(confidence, autoApplyThreshold - 0.01);
    reasons.push("missing_or_invalid_price");
  }
  if (!extraction.renewalDate) {
    confidence = Math.min(confidence, autoApplyThreshold - 0.01);
    reasons.push("missing_or_implausible_renewal_date");
  }
  if (extraction.billingCycle === "unknown") {
    confidence = Math.min(confidence, autoApplyThreshold - 0.01);
    reasons.push("unknown_billing_cycle");
  }

  confidence = Math.min(1, Math.max(0, confidence));
  return {
    confidence,
    reviewReason: reasons.length > 0 ? reasons.join(",") : null,
  };
}
