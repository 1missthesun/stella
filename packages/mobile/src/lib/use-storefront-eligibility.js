import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  addStorefrontChangeListener,
  getStorefrontCountryCode,
  isStorefrontModuleAvailable,
} from "../../modules/stella-storefront";

/**
 * Region gating for the mobile subscription surface.
 *
 * Eligibility for in-app subscription purchase is decided ONLY by the App
 * Store storefront country reported by StoreKit (see the native module). US
 * storefront -> eligible; every other storefront, plus "unknown" (no App
 * Store account, StoreKit unavailable, non-iOS, module missing), fails closed
 * to ineligible. Device language/locale and IP are never consulted.
 *
 * The value is re-read on mount, whenever the app returns to the foreground,
 * and whenever StoreKit reports a storefront change, so the UI re-gates
 * without a restart.
 */
export const US_STOREFRONT_CODE = "USA";

let debugStorefrontOverride;

export function setDebugStorefrontOverride(codeOrNull) {
  if (!__DEV__) return;
  debugStorefrontOverride =
    codeOrNull == null ? codeOrNull : String(codeOrNull).trim().toUpperCase();
}

// StoreKit can leave the storefront lookup unanswered (no App Store account,
// mid sign-in). Fail closed instead of waiting: a later foreground or
// storefront-change event re-reads it.
const STOREFRONT_TIMEOUT_MS = 5000;

async function resolveStorefrontCountryCode() {
  if (__DEV__ && debugStorefrontOverride !== undefined) {
    return debugStorefrontOverride;
  }
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), STOREFRONT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([getStorefrontCountryCode(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {{
 *   status: "loading" | "eligible" | "ineligible",
 *   countryCode: string | null,
 *   moduleAvailable: boolean,
 *   refresh: () => void,
 * }}
 */
export function useStorefrontEligibility() {
  const [state, setState] = useState({ status: "loading", countryCode: null });
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const code = await resolveStorefrontCountryCode();
    if (!mountedRef.current) return;
    setState({
      status: code === US_STOREFRONT_CODE ? "eligible" : "ineligible",
      countryCode: code ?? null,
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    const appStateSub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });
    const storefrontSub = addStorefrontChangeListener(() => {
      void refresh();
    });

    return () => {
      mountedRef.current = false;
      appStateSub.remove();
      storefrontSub.remove();
    };
  }, [refresh]);

  return {
    status: state.status,
    countryCode: state.countryCode,
    moduleAvailable: isStorefrontModuleAvailable(),
    refresh: () => void refresh(),
  };
}
