import { mixOklch, sheet } from "../../theme";
import { onPhone } from "../../shell/phone";

/** Row icon size: the phone's rows are touch-sized, like its other lists. */
export const appsRowIconSize = (): number => (onPhone() ? 20 : 16);

export const useAppsSection = sheet((c) => {
  const phone = onPhone();
  return {
  appsSectionBody: { grow: 1, shrink: true, minW: 0, minH: 0 },
  appsSectionLibrary: { absolute: { left: 0, top: 0, right: 0, bottom: 0 }, clip: 0, minH: 0 },
  appsSectionGrid: { gap: 2 },
  cloudAppsLibrary: { pt: 8, pb: 7, px: phone ? 12 : 10, border: c.borderWeak, borderSides: [0, 0, 1, 0] },
  cloudAppsLibraryHeading: { pb: 3, px: phone ? 12 : 9, align: "center", justify: "between", gap: 8, minH: phone ? 34 : 28, color: c.textWeak, size: phone ? 13 : 12, weight: 500 },
  cloudAppsLibraryGrid: { pad: 0 },
  cloudAppsLibraryBadge: { color: c.textWeak, size: 12 },
  cloudAppsLibraryStatus: { py: 10, px: 14, align: "center", justify: "center", gap: 7, color: c.textWeak, size: 12 },
  appsSectionCard: { pad: 0, w: "full", align: "center", minH: phone ? 52 : 40, radius: phone ? 12 : 8, color: c.foreground, motion: { dur: 0.12 }, hover: mixOklch(c.foreground, 5, "transparent"), hoverColor: c.textStrong },
  appsSectionCardOpen: { py: phone ? 12 : 8, px: phone ? 12 : 9, grow: 1, shrink: true, minW: 0, selfAlign: "stretch", align: "center", gap: phone ? 14 : 9, textAlign: "start" },
  appsSectionCardLabel: { grow: 1, shrink: true, minW: 0, maxW: "full", color: c.textStrong, size: phone ? 16 : 13, weight: 400, lh: 1.35, truncate: true, nowrap: true },
  appsSectionCardIcon: { color: c.textWeak },
  persistentUserAppStatus: { py: 24, px: 20, absolute: { left: 0, top: 0, right: 0, bottom: 0 }, align: "center", justify: "center", gap: 10, color: c.textWeak, textAlign: "center", fill: c.background },
  persistentUserAppStatus_strong: { color: c.textStrong, size: 13 },
  persistentCloudAppSurface: { absolute: { left: 0, top: 0, right: 0, bottom: 0 }, shrink: true, minW: 0, minH: 0 },
  appsSectionLoading: { pad: 24, grow: 1, shrink: true, minW: 0, align: "center", justify: "center", gap: 7, color: c.textWeak, size: phone ? 14 : 12 },
  appsSectionRefreshError: { py: 10, px: 14, align: "center", justify: "center", gap: 8, color: c.textWeak, size: 12 },
  appsSectionRetry: { pad: 0, color: c.textBase, weight: 500, underline: true },
  };
});
