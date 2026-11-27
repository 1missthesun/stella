import { hex, sheet } from "../../theme";

export const useGetTheApp = sheet((c) => ({
  getApp: { align: "center", gap: 16 },
  getAppPlatforms: { pad: 4, gap: 2, radius: 9999, fill: c.surfaceInset, border: c.borderWeak },
  getAppPlatform: { family: "sans", px: 14, align: "center", gap: 6, h: 28, radius: 9999, color: c.textWeak, size: 12, weight: 600, em: -0.005, motion: { dur: 0.15 }, hoverColor: c.textStrong },
  getAppPlatformActive: { fill: c.background, color: c.textStrong, shadows: [{ x: 0, y: 0, blur: 0, spread: 1, color: c.borderWeak }, { x: 0, y: 1, blur: 2, color: hex("rgba(0, 0, 0, 0.08)") }] },
  getAppPlatform_svg: { w: 14, h: 14 },
  getAppQr: { pad: 8, w: 168, h: 168, radius: 12, fill: "#ffffff", shadows: [{ x: 0, y: 0, blur: 0, spread: 1, color: c.borderWeak }] },
  getAppQr_img: { w: 152, h: 152 },
  getAppQrPlaceholder: { w: 152, h: 152, radius: 8, fill: "#f2f2f2" },
}));
