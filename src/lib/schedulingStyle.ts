/**
 * Tipos, defaults e helpers do "estilo" do Widget de Agendamento.
 * Os campos viram CSS variables aplicadas no container raiz do PublicSchedule.
 */

export type RadiusKey = "none" | "sm" | "md" | "lg" | "xl" | "2xl";
export type HeaderAlign = "left" | "center";

export interface SchedulingStyle {
  // Cores
  primaryColor: string;
  primaryTextColor: string;
  pageBgColor: string;
  cardBgColor: string;
  textColor: string;
  mutedTextColor: string;
  inputBgColor: string;
  inputBorderColor: string;
  inputTextColor: string;
  timeButtonBgColor: string;
  timeButtonBorderColor: string;
  timeButtonTextColor: string;

  // Tipografia
  titleFont: string;
  bodyFont: string;
  titleWeight: number;
  titleSizeDesktop: number;
  titleSizeMobile: number;
  descriptionSize: number;
  labelSize: number;
  ctaSize: number;

  // Tamanhos
  radiusCard: RadiusKey;
  radiusInput: RadiusKey;
  radiusButton: RadiusKey;
  inputHeight: number;
  ctaHeight: number;
  cardPadding: number;
  fieldGap: number;

  // Logo
  showLogo: boolean;
  logoUrl: string;
  logoHeight: number;
  headerAlign: HeaderAlign;
}

export const DEFAULT_SCHEDULING_STYLE: SchedulingStyle = {
  primaryColor: "#DE1A11",
  primaryTextColor: "#FFFFFF",
  pageBgColor: "#0D0B0A",
  cardBgColor: "#0D0B0A",
  textColor: "#FAFAF9",
  mutedTextColor: "#8C7A6E",
  inputBgColor: "transparent",
  inputBorderColor: "#262220",
  inputTextColor: "#FAFAF9",
  timeButtonBgColor: "transparent",
  timeButtonBorderColor: "#262220",
  timeButtonTextColor: "#FAFAF9",

  titleFont: "Video",
  bodyFont: "Inter",
  titleWeight: 700,
  titleSizeDesktop: 28,
  titleSizeMobile: 20,
  descriptionSize: 14,
  labelSize: 13,
  ctaSize: 16,

  radiusCard: "xl",
  radiusInput: "lg",
  radiusButton: "xl",
  inputHeight: 44,
  ctaHeight: 48,
  cardPadding: 24,
  fieldGap: 16,

  showLogo: true,
  logoUrl: "",
  logoHeight: 40,
  headerAlign: "center",
};

export const RADIUS_PX: Record<RadiusKey, number> = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 24,
};

/** Fontes disponíveis (chave = family name carregada via Google Fonts) */
export const SCHEDULING_FONTS: { name: string; google?: string; weights?: string }[] = [
  { name: "Video" }, // Fonte local "display" do projeto
  { name: "Inter", google: "Inter", weights: "400;500;600;700" },
  { name: "Poppins", google: "Poppins", weights: "400;500;600;700" },
  { name: "Space Grotesk", google: "Space+Grotesk", weights: "400;500;600;700" },
  { name: "DM Serif Display", google: "DM+Serif+Display" },
  { name: "Sora", google: "Sora", weights: "400;500;600;700" },
  { name: "Manrope", google: "Manrope", weights: "400;500;600;700" },
];

export function mergeStyle(partial: Partial<SchedulingStyle> | null | undefined): SchedulingStyle {
  if (!partial) return { ...DEFAULT_SCHEDULING_STYLE };
  return { ...DEFAULT_SCHEDULING_STYLE, ...partial };
}

/** Converte o estilo em CSS variables a aplicar no container raiz. */
export function toCssVars(style: SchedulingStyle): React.CSSProperties {
  return {
    // Cores
    "--sw-primary": style.primaryColor,
    "--sw-primary-text": style.primaryTextColor,
    "--sw-page-bg": style.pageBgColor,
    "--sw-card-bg": style.cardBgColor,
    "--sw-text": style.textColor,
    "--sw-muted": style.mutedTextColor,
    "--sw-input-bg": style.inputBgColor,
    "--sw-input-border": style.inputBorderColor,
    "--sw-input-text": style.inputTextColor,
    "--sw-time-button-bg": style.timeButtonBgColor,
    "--sw-time-button-border": style.timeButtonBorderColor,
    "--sw-time-button-text": style.timeButtonTextColor,

    // Tipografia
    "--sw-font-title": fontStack(style.titleFont),
    "--sw-font-body": fontStack(style.bodyFont),
    "--sw-title-weight": String(style.titleWeight),
    "--sw-title-size-desktop": `${style.titleSizeDesktop}px`,
    "--sw-title-size-mobile": `${style.titleSizeMobile}px`,
    "--sw-description-size": `${style.descriptionSize}px`,
    "--sw-label-size": `${style.labelSize}px`,
    "--sw-cta-size": `${style.ctaSize}px`,

    // Tamanhos
    "--sw-radius-card": `${RADIUS_PX[style.radiusCard]}px`,
    "--sw-radius-input": `${RADIUS_PX[style.radiusInput]}px`,
    "--sw-radius-button": `${RADIUS_PX[style.radiusButton]}px`,
    "--sw-input-height": `${style.inputHeight}px`,
    "--sw-cta-height": `${style.ctaHeight}px`,
    "--sw-card-padding": `${style.cardPadding}px`,
    "--sw-field-gap": `${style.fieldGap}px`,
  } as React.CSSProperties;
}

function fontStack(name: string): string {
  if (name === "Video") return `'Video', 'Inter', system-ui, sans-serif`;
  if (name === "DM Serif Display") return `'DM Serif Display', Georgia, serif`;
  return `'${name}', 'Inter', system-ui, sans-serif`;
}

/** Garante que as fontes do estilo estejam carregadas via Google Fonts. */
const _loadedFonts = new Set<string>();
export function ensureFontLoaded(name: string) {
  if (typeof document === "undefined") return;
  const def = SCHEDULING_FONTS.find((f) => f.name === name);
  if (!def?.google) return; // Video ou fonte sem Google
  if (_loadedFonts.has(def.google)) return;
  _loadedFonts.add(def.google);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${def.google}${
    def.weights ? `:wght@${def.weights}` : ""
  }&display=swap`;
  document.head.appendChild(link);
}
