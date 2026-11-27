// What a subscription checkout must say about the store the app came from. Desktop: nothing.
// The phone replaces this module (packages/mobile-rune/js/replace/ui/global/billing/store-checkout.ts):
// iOS checkouts name their App Store storefront, since the backend only opens one for the US
// storefront (as for the RN app).

export type StoreCheckoutFields = { source?: string; appStoreCountry?: string };

export async function storeCheckoutFields(): Promise<StoreCheckoutFields> {
  return {};
}
