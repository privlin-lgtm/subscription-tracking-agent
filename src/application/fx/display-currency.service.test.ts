import { describe, expect, it } from "vitest";
import { ValidationError } from "@/domain/errors";
import { DisplayCurrencyService } from "@/application/fx/display-currency.service";
import { InMemoryUserPreferences } from "@/application/fx/in-memory-fx";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";

function build() {
  const preferences = new InMemoryUserPreferences();
  const { audit } = createInMemoryPersistence();
  return { preferences, audit, svc: new DisplayCurrencyService(preferences, audit, "ILS") };
}

describe("DisplayCurrencyService", () => {
  it("falls back to the config default until the user picks one", async () => {
    const { svc } = build();
    expect(await svc.get("user_a")).toBe("ILS");
  });

  it("stores a supported choice per user and audits it", async () => {
    const { svc, audit } = build();
    expect(await svc.set("user_a", "usd")).toBe("USD");
    expect(await svc.get("user_a")).toBe("USD");
    expect(await svc.get("user_b")).toBe("ILS");
    const log = await audit.listByUser("user_a");
    expect(log[0]).toMatchObject({ action: "settings.display_currency", actor: "user", details: { currency: "USD" } });
  });

  it("rejects codes that are not offered or not currencies", async () => {
    const { svc, preferences } = build();
    await expect(svc.set("user_a", "SEK")).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.set("user_a", "zzz")).rejects.toBeInstanceOf(ValidationError);
    expect(await preferences.getDisplayCurrency("user_a")).toBeNull();
  });

  it("ignores a stored value that is no longer a valid currency", async () => {
    const { svc, preferences } = build();
    await preferences.setDisplayCurrency("user_a", "???");
    expect(await svc.get("user_a")).toBe("ILS");
  });
});
