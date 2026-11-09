/**
 * Currencies a user can pick as their display currency on the settings page. The daily FX
 * job always keeps rates for every one of these (plus whatever currencies subscriptions
 * actually use), so switching between them takes effect immediately rather than waiting for
 * the next rate fetch.
 */
export const DISPLAY_CURRENCY_OPTIONS = ["ILS", "USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCY_OPTIONS)[number];

export function isDisplayCurrencyOption(code: string): code is DisplayCurrency {
  return (DISPLAY_CURRENCY_OPTIONS as readonly string[]).includes(code);
}
