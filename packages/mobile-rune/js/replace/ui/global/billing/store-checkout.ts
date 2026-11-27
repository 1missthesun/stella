// iOS: the App Store storefront (StoreKit 2's `Storefront.current`, ios/StellaRune/Store.swift)
// goes with every subscription checkout, as the RN app's stella-storefront module sends it. The
// backend opens Stripe checkout only for the US storefront and answers others with why.

import { phoneRequest } from "../../../../../ui/native/app";
import type { StoreCheckoutFields } from "../../../../../../desktop-rune/ui/global/billing/store-checkout";

export type { StoreCheckoutFields };

/** StoreKit can leave the lookup unanswered (no App Store account, mid sign-in): fail closed after 5 s, as the RN app does. */
const STOREFRONT_TIMEOUT_MS = 5_000;

export async function storefrontCountry(): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), STOREFRONT_TIMEOUT_MS));
  const lookup = phoneRequest<{ countryCode: string | null }>("storefront.country").then((r) => r.countryCode?.trim().toUpperCase() || null, () => null);
  return await Promise.race([lookup, timeout]);
}

export async function storeCheckoutFields(): Promise<StoreCheckoutFields> {
  const country = await storefrontCountry();
  return { source: "ios", ...(country ? { appStoreCountry: country } : {}) };
}
