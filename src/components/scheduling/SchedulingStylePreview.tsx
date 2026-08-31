import { useEffect, useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { ensureFontLoaded, mergeStyle, toCssVars, type SchedulingStyle } from "@/lib/schedulingStyle";

interface Props {
  style: Partial<SchedulingStyle>;
  title?: string;
  description?: string;
  ctaLabel?: string;
}

/**
 * Mini renderização do "passo 1" do widget de agendamento, controlada pelo estilo.
 * Usada no editor de aparência para pré-visualização ao vivo.
 */
export default function SchedulingStylePreview({
  style,
  title = "Diagnóstico Gratuito de IA",
  description = "Preencha seus dados para descobrir como a IA pode transformar seu negócio.",
  ctaLabel = "Continuar",
}: Props) {
  const merged = useMemo(() => mergeStyle(style), [style]);
  const cssVars = useMemo(() => toCssVars(merged), [merged]);

  useEffect(() => {
    ensureFontLoaded(merged.titleFont);
    ensureFontLoaded(merged.bodyFont);
  }, [merged.titleFont, merged.bodyFont]);

  const alignClass = merged.headerAlign === "left" ? "text-left items-start" : "text-center items-center";

  return (
    <div
      className="w-full h-full min-h-[460px] flex items-center justify-center p-4"
      style={{ ...(cssVars as React.CSSProperties), background: "var(--sw-page-bg)" }}
    >
      <div
        className="w-full max-w-sm"
      >
        <div
          style={{
            background: "var(--sw-card-bg)",
            borderRadius: "var(--sw-radius-card)",
            padding: "var(--sw-card-padding)",
            border: "1px solid rgba(255,255,255,0.06)",
            fontFamily: "var(--sw-font-body)",
            color: "var(--sw-text)",
          }}
        >
          <div className={`flex flex-col ${alignClass} gap-1 mb-5`}>
            {merged.showLogo && merged.logoUrl && (
              <img
                src={merged.logoUrl}
                alt=""
                style={{ height: `${merged.logoHeight}px`, marginBottom: 8 }}
                onError={(e) => ((e.currentTarget.style.display = "none"))}
              />
            )}
            <h2
              style={{
                fontFamily: "var(--sw-font-title)",
                fontWeight: "var(--sw-title-weight)" as unknown as number,
                fontSize: "var(--sw-title-size-desktop)",
                color: "var(--sw-text)",
                lineHeight: 1.15,
              }}
            >
              {title}
            </h2>
            {description && (
              <p
                style={{
                  fontSize: "var(--sw-description-size)",
                  color: "var(--sw-muted)",
                  marginTop: 6,
                }}
              >
                {description}
              </p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sw-field-gap)" }}>
            {[
              { label: "Nome completo *", ph: "•••• ••• ••••" },
              { label: "E-mail corporativo *", ph: "••••••••••••••••" },
              { label: "WhatsApp *", ph: "•••• ••••••••••" },
            ].map((f) => (
              <div key={f.label}>
                <div
                  style={{
                    fontSize: "var(--sw-label-size)",
                    fontWeight: 600,
                    color: "var(--sw-input-text)",
                    marginBottom: 6,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{
                    height: "var(--sw-input-height)",
                    background: "var(--sw-input-bg)",
                    border: "1px solid var(--sw-input-border)",
                    borderRadius: "var(--sw-radius-input)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 14px",
                    color: "var(--sw-input-text)",
                    opacity: 0.7,
                    fontSize: 14,
                    letterSpacing: 2,
                  }}
                >
                  {f.ph}
                </div>
              </div>
            ))}

            <button
              type="button"
              style={{
                height: "var(--sw-cta-height)",
                background: "var(--sw-primary)",
                color: "var(--sw-primary-text)",
                borderRadius: "var(--sw-radius-button)",
                fontSize: "var(--sw-cta-size)",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 4,
                cursor: "pointer",
                border: "none",
              }}
            >
              {ctaLabel} <ArrowRight className="h-4 w-4" />
            </button>

            <div className="grid grid-cols-3 gap-2 mt-2">
              {["09:00", "10:30", "14:00"].map((t, i) => (
                <div
                  key={t}
                  style={{
                    height: 36,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "var(--sw-radius-button)",
                    fontSize: 12,
                    fontWeight: 600,
                    background: i === 0 ? "var(--sw-primary)" : "var(--sw-time-button-bg)",
                    color: i === 0 ? "var(--sw-primary-text)" : "var(--sw-time-button-text)",
                    border: i === 0 ? "1px solid var(--sw-primary)" : "1px solid var(--sw-time-button-border)",
                  }}
                >
                  {t}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-center gap-1.5 mt-2">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "var(--sw-primary)",
                }}
              />
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.18)",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
