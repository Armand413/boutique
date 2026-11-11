import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Couleurs du design system (A.2) : principale puis succès, lisibles dans les deux thèmes. */
const SERIES_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-info)',
] as const;

function colorOf(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? 'var(--color-primary)';
}

export interface ChartSeries {
  key: string;
  label: string;
}

export interface SimpleChartProps {
  type: 'bar' | 'line';
  data: readonly Record<string, string | number | null>[];
  labelKey: string;
  series: readonly ChartSeries[];
  /** Résumé lu par les lecteurs d'écran à la place du dessin (WCAG 1.1.1). */
  summary: string;
  formatValue: (value: number) => string;
  formatLabel?: (label: string) => string;
  height?: number;
}

function compact(value: number): string {
  return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

/**
 * Graphique simple (4.8 : courbes, histogrammes). Le dessin est masqué aux technologies
 * d'assistance : son résumé textuel et le tableau voisin portent l'information.
 */
export function SimpleChart({
  type,
  data,
  labelKey,
  series,
  summary,
  formatValue,
  formatLabel = (label) => label,
  height = 260,
}: SimpleChartProps) {
  const rows = data.map((row) => ({ ...row }));
  const axes = (
    <>
      <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey={labelKey}
        tickFormatter={(value: string) => formatLabel(value)}
        stroke="var(--color-muted-foreground)"
        fontSize={12}
        tickLine={false}
        minTickGap={16}
      />
      <YAxis
        tickFormatter={(value: number) => compact(value)}
        stroke="var(--color-muted-foreground)"
        fontSize={12}
        tickLine={false}
        width={56}
      />
      <Tooltip
        formatter={(value) => formatValue(Number(value))}
        labelFormatter={(label) =>
          typeof label === 'string' || typeof label === 'number' ? formatLabel(String(label)) : ''
        }
        contentStyle={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          color: 'var(--color-foreground)',
        }}
        isAnimationActive={false}
      />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="sr-only">{summary}</p>
      <div aria-hidden="true" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {type === 'line' ? (
            <LineChart data={rows} accessibilityLayer={false}>
              {axes}
              {series.map((item, index) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.label}
                  stroke={colorOf(index)}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={rows} accessibilityLayer={false}>
              {axes}
              {series.map((item, index) => (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  name={item.label}
                  fill={colorOf(index)}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
