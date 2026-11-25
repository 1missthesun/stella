import { Button, Popover, PopoverBody, PopoverContent, PopoverTrigger, Press, T, ThemeOrb } from "../kit/compat";
import { mixOklch, sheet, type Style } from "../theme";
import {
  useState,
  useMemo,
  isValidElement,
  type ReactElement,
} from "react";
import { useTheme, useThemeControl } from "@/context/theme-context";
import { isHiddenOverlay } from "@stella/theme";

type ColorScheme = "light" | "dark" | "system";

const useThemePicker = sheet((c, t) => ({
  sections: { pad: 12, gap: 4, scrollY: true },
  sectionsInline: { pt: 4, px: 2, pb: 16 },
  section: { gap: 4 },
  sectionBordered: { pb: 8, mb: 8, borderSides: [0, 0, 1, 0], border: mixOklch(c.border, 50, "transparent") },
  sectionDisabled: { opacity: 0.58 },
  label: { py: 4, px: 8, mt: 4, family: "Manrope", size: 11, weight: 600, em: -0.02, lh: 1.5, color: c.mutedForeground },
  labelRow: { align: "center", justify: "between", gap: 8 },
  themeName: { truncate: true, nowrap: true, color: c.foreground, weight: 500, shrink: true, minW: 0 },
  buttonRow: { gap: 4 },
  optionButton: { grow: 1, shrink: true, minW: 0, w: 0, justify: "center", px: 9 },
  optionButtonActive: { fill: c.selectFill, border: c.selectBorder, color: c.selectText, shadows: [], hover: mixOklch(c.primary, 20, "transparent") },
  grid: { pt: 2, px: 8, pb: 4, gap: 6, wrap: true },
  orb: { w: 26, h: 26, radius: 13, border: mixOklch(c.foreground, 12, "transparent"), opacity: 0.82, motion: { dur: 0.2 }, pressScale: 0.94 },
  orbHover: { opacity: 1, scale: 1.08, border: mixOklch(c.foreground, 28, "transparent") },
  orbActive: { opacity: 1, border: c.selectBorder, shadows: [{ x: 0, y: 0, blur: 0, spread: 2, color: c.selectFill }] },
  trigger: { px: 13, size: 12, weight: 500, color: c.mutedForeground, hoverColor: c.foreground },
  content: { w: 296 },
}));

const COLOR_SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

interface ThemePickerProps {
  inline?: boolean;
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onThemeSelect?: () => void;
  trigger?: ReactElement;
  triggerLabel?: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  anchor?: string;
}

export function ThemePicker({
  inline = false,
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onThemeSelect,
  trigger,
  triggerLabel = "Theme",
  side = "top",
  align = "end",
  anchor,
}: ThemePickerProps) {
  const {
    selectedThemeId,
    themes,
    colorMode,
    gradientMode,
    gradientColor,
    flat,
    resolvedColorMode,
  } = useTheme();
  const {
    setTheme,
    setColorMode,
    setGradientMode,
    setGradientColor,
    previewTheme,
    cancelThemePreview,
    cancelPreview,
  } = useThemeControl();

  const [internalOpen, setInternalOpen] = useState(false);
  const [hoveredThemeId, setHoveredThemeId] = useState<string | null>(null);
  const [hoveredOrbId, setHoveredOrbId] = useState<string | null>(null);

  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  const sortedThemes = useMemo(
    () =>
      [...themes]
        .filter((t) => !isHiddenOverlay(t))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [themes]
  );

  const selectedTheme = useMemo(
    () => sortedThemes.find((t) => t.id === selectedThemeId),
    [sortedThemes, selectedThemeId]
  );
  const hoveredTheme = useMemo(
    () => sortedThemes.find((t) => t.id === hoveredThemeId),
    [sortedThemes, hoveredThemeId]
  );


  const s = useThemePicker();
  const triggerElement = trigger && isValidElement(trigger) ? trigger : null;
  const popoverTrigger = triggerElement;

  const optionButton = (active: boolean): Omit<Style, "size"> => ({ ...s.optionButton, ...(active ? s.optionButtonActive : null) });

  const themeContent = (
    <col {...s.sections} {...(inline ? s.sectionsInline : null)} maxH={inline ? undefined : 560} onHover={(inside) => {
        if (inside) return;
        setHoveredThemeId(null);
        cancelPreview();
      }}>
      <col {...s.section} {...s.sectionBordered}>
        <T {...s.label} mt={0} w="full">Appearance</T>
        <row {...s.buttonRow}>
          {COLOR_SCHEMES.map((scheme) => (
            <Button key={scheme.id} size="small" variant={colorMode === scheme.id ? "secondary" : "ghost"} {...optionButton(colorMode === scheme.id)} onClick={() => setColorMode(scheme.id)}>
              {scheme.label}
            </Button>
          ))}
        </row>
      </col>

      <col {...s.section} {...s.sectionBordered} {...(flat ? s.sectionDisabled : null)} role="group" label="Gradient controls" disabled={flat || undefined}>
        <T {...s.label} mt={0} w="full">Gradient Style</T>
        <row {...s.buttonRow}>
          {(["soft", "flat"] as const).map((value) => (
            <Button key={value} size="small" variant={gradientMode === value ? "secondary" : "ghost"} {...optionButton(gradientMode === value)} onClick={() => setGradientMode(value)} disabled={flat}>
              {value === "soft" ? "Soft" : "Flat"}
            </Button>
          ))}
        </row>

        <T {...s.label} w="full">Gradient Color</T>
        <row {...s.buttonRow}>
          {(["relative", "strong"] as const).map((value) => (
            <Button key={value} size="small" variant={gradientColor === value ? "secondary" : "ghost"} {...optionButton(gradientColor === value)} onClick={() => setGradientColor(value)} disabled={flat}>
              {value === "relative" ? "Relative" : "Strong"}
            </Button>
          ))}
        </row>
      </col>

      <col {...s.section}>
        <row {...s.label} mt={0} {...s.labelRow}>
          <T {...s.label} py={0} px={0} mt={0}>Theme</T>
          <T {...s.label} py={0} px={0} mt={0} {...s.themeName}>
            {(hoveredTheme ?? selectedTheme)?.name ?? ""}
          </T>
        </row>
        <row {...s.grid} onHover={(inside) => {
            if (inside) return;
            setHoveredThemeId(null);
            cancelThemePreview();
          }}>
          {sortedThemes.map((t) => {
            const isSelected = t.id === selectedThemeId;
            const preview = () => {
              if (!open && !inline) return;
              setHoveredThemeId(t.id);
              previewTheme(t.id);
            };
            return (
              <Press key={t.id} {...s.orb} {...(hoveredOrbId === t.id ? s.orbHover : null)} {...(isSelected ? s.orbActive : null)} label={t.name} selected={isSelected} title={t.name} onPress={() => {
                  setTheme(t.id);
                  cancelPreview();
                  if (!inline) setOpen(false);
                  onThemeSelect?.();
                }} onHover={(inside) => {
                  setHoveredOrbId((id) => (inside ? t.id : id === t.id ? null : id));
                  if (inside) preview();
                }} onFocus={(focused) => focused && preview()}>
                <ThemeOrb theme={t} isDark={resolvedColorMode === "dark"} />
              </Press>
            );
          })}
        </row>
      </col>
    </col>
  );

  if (inline) {
    return (
      <col w="full">
        <PopoverBody pad={0}>{themeContent}</PopoverBody>
      </col>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setHoveredThemeId(null);
          cancelPreview();
        }
      }}>
      {anchor && hideTrigger ? null : (
        <PopoverTrigger asChild>
          {popoverTrigger ?? (
            <Button {...(s.trigger as Omit<Style, "size">)} variant="ghost" size="normal" {...(hideTrigger ? { opacity: 0, inert: true, absolute: {} } : null)}>
              {triggerLabel}
            </Button>
          )}
        </PopoverTrigger>
      )}
      <PopoverContent {...s.content} side={side} align={align} anchorTo={anchor} collisionPadding={8}>
        <PopoverBody pad={0}>{themeContent}</PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
