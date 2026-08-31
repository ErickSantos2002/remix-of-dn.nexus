import { useId } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { scoreBandColor, SCORE_BANDS } from "@/lib/analysisCatalog";

export interface ScorePoint {
  date: string;
  score: number;
}

interface Props {
  data: ScorePoint[];
  /** Rótulo usado no tooltip. */
  seriesLabel?: string;
}

/**
 * Evolução do score por dia usando as faixas de cor da avaliação.
 * A linha recebe um gradiente horizontal com um stop por dia, então a cor
 * transiciona suavemente quando o score muda de faixa entre dois dias.
 *
 * A opacidade do preenchimento vem de --viz-band-fill, que muda por tema:
 * 0.4 no dark e 0.62 no premium, porque sobre o fundo claro as cores das
 * faixas lavam e o gradiente perde definição.
 */
export function ScoreEvolutionChart({ data, seriesLabel = "Score médio" }: Props) {
  const uid = useId().replace(/[:]/g, "");
  const strokeId = `scoreStroke-${uid}`;
  const fillId = `scoreFill-${uid}`;
  const maskId = `scoreMask-${uid}`;
  const fadeId = `scoreFade-${uid}`;

  const stops = data.map((point, index) => ({
    offset: data.length > 1 ? (index / (data.length - 1)) * 100 : 0,
    color: scoreBandColor(point.score),
  }));

  return (
    <div className="space-y-3">
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
                {stops.map((stop, i) => (
                  <stop key={i} offset={`${stop.offset}%`} stopColor={stop.color} />
                ))}
              </linearGradient>
              <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="0">
                {stops.map((stop, i) => (
                  <stop
                    key={i}
                    offset={`${stop.offset}%`}
                    style={{ stopColor: stop.color, stopOpacity: "var(--viz-band-fill)" }}
                  />
                ))}
              </linearGradient>
              {/* Máscara de luminância: branco = opaco. Independe de tema. */}
              <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fff" stopOpacity={1} />
                <stop offset="100%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <mask id={maskId}>
                <rect x="0" y="0" width="100%" height="100%" fill={`url(#${fadeId})`} />
              </mask>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              stroke="var(--chart-axis)"
              fontSize={12}
              tickFormatter={(value: string) => format(parseISO(value), "dd/MM", { locale: ptBR })}
            />
            <YAxis stroke="var(--chart-axis)" fontSize={12} domain={[0, 100]} />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "0.5rem",
                fontSize: "0.75rem",
              }}
              labelFormatter={(value: string) =>
                format(parseISO(value), "dd 'de' MMMM", { locale: ptBR })
              }
              formatter={(value: number) => [`${value}/100`, seriesLabel]}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke={`url(#${strokeId})`}
              strokeWidth={2}
              fill={`url(#${fillId})`}
              mask={`url(#${maskId})`}
              dot={(props: { cx?: number; cy?: number; payload?: ScorePoint; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx == null || cy == null || !payload) {
                  return <g key={`dot-${index}`} />;
                }
                return (
                  <circle
                    key={`dot-${index}`}
                    cx={cx}
                    cy={cy}
                    r={3.5}
                    fill={scoreBandColor(payload.score)}
                    stroke="hsl(var(--background))"
                    strokeWidth={1.5}
                  />
                );
              }}
              activeDot={(props: { cx?: number; cy?: number; payload?: ScorePoint; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx == null || cy == null || !payload) {
                  return <g key={`active-${index}`} />;
                }
                return (
                  <circle
                    key={`active-${index}`}
                    cx={cx}
                    cy={cy}
                    r={5.5}
                    fill={scoreBandColor(payload.score)}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                );
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {SCORE_BANDS.map((band) => (
          <span key={band.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: band.color }} />
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}
