import { hex, mixOklch, sheet } from "../../theme";

export const useEngineAccounts = sheet((c) => ({
  engineAccountBadge: { align: "center", gap: 4, size: 11, weight: 600, lh: 1.6, color: c.selectText, nowrap: true },
  settingsRowEngineAccountRow: { py: 8, px: 10, mx: -10, radius: 12 },
  settingsRowEngineAccountRowActive: { fill: mixOklch(c.primary, 7, "transparent") },
  settingsRowEngineAccountRowActive_engineAccountBadge: { color: c.primary },
  engineAccountIdentity: { align: "center", gap: 10, shrink: true, minW: 0 },
  engineAccountIdentityText: { shrink: true, minW: 0 },
  engineAccountIdentityText_settingsRowLabel: { truncate: true },
  engineAccountIdentityPick: { py: 6, px: 8, my: -6, mx: -8, radius: 10, textAlign: "start", cursor: "pointer", motion: { dur: 0.12 }, hover: hex("rgb(0 0 0 / 4%)") },
  engineAccountIdentityPickDisabled: { cursor: "default", hover: undefined },
  engineAccountControls: { align: "center", gap: 6 },
  engineAccountPlaces: { mt: 3, wrap: true, rowGap: 4, gap: 10, size: 11, color: c.textWeak },
  engineAccountPlace: { align: "center", gap: 5 },
  engineAccountPlaceInUse: { color: c.textStrong },
  engineAccountAdd: { align: "center", gap: 6 },
}));
