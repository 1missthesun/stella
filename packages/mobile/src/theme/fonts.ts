import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_500Medium } from "@expo-google-fonts/manrope/500Medium";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { MonaSans_600SemiBold } from "@expo-google-fonts/mona-sans/600SemiBold";

export const criticalStellaFontAssets = {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  MonaSans_600SemiBold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
};

export const deferredStellaFontAssets = {
  Manrope_500Medium,
};

export const fonts = {
  sans: {
    regular: "Manrope_400Regular",
    medium: "Manrope_500Medium",
    semiBold: "Manrope_600SemiBold",
    bold: "Manrope_700Bold",
  },
  display: {
    semiBold: "MonaSans_600SemiBold",
  },
  mono: {
    regular: "IBMPlexMono_400Regular",
    medium: "IBMPlexMono_500Medium",
  },
} as const;
