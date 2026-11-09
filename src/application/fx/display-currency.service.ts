import { ValidationError } from "@/domain/errors";
import type { AuditRepository, UserPreferencesRepository } from "@/domain/repositories";
import { tryNormalizeCurrency } from "@/domain/value-objects/currency";
import { isDisplayCurrencyOption } from "@/shared/display-currencies";

export class DisplayCurrencyService {
  constructor(
    private readonly preferences: UserPreferencesRepository,
    private readonly audit: AuditRepository,
    private readonly defaultCurrency: string,
  ) {}

  /** The user's own choice, falling back to the config default (DEFAULT_DISPLAY_CURRENCY). */
  async get(userId: string): Promise<string> {
    const chosen = tryNormalizeCurrency(await this.preferences.getDisplayCurrency(userId));
    return chosen ?? this.defaultCurrency;
  }

  async set(userId: string, raw: string): Promise<string> {
    const currency = tryNormalizeCurrency(raw);
    if (!currency || !isDisplayCurrencyOption(currency)) {
      throw new ValidationError("Unsupported display currency");
    }
    await this.preferences.setDisplayCurrency(userId, currency);
    await this.audit.record({
      userId,
      action: "settings.display_currency",
      actor: "user",
      details: { currency },
    });
    return currency;
  }
}
