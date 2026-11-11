import type {
  COLUMN_TYPES,
  EnumKey,
  ReportColumn,
  ReportKind,
  ReportResult,
  ReportRow,
} from '@shared/schemas/reports';

/** Contexte d'un calcul de rapport : droits du demandeur, horloge et limite d'affichage. */
export interface ReportContext {
  canSeeCost: boolean;
  now: Date;
  /** null pour un export complet. */
  limit: number | null;
}

/** Nombre de lignes affichées à l'écran ; l'export reprend toutes les lignes. */
export const DISPLAY_LIMIT = 2000;

type ColumnType = (typeof COLUMN_TYPES)[number];

export function col(
  key: string,
  type: ColumnType,
  options: { sensitive?: boolean; enumKey?: EnumKey } = {},
): ReportColumn {
  return { key, type, sensitive: options.sensitive ?? false, enumKey: options.enumKey ?? null };
}

export interface ReportParts {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  summary?: { key: string; type: ColumnType; value: number; sensitive?: boolean }[];
  chart?: ReportResult['chart'];
}

function withoutKeys(row: ReportRow, hidden: ReadonlySet<string>): ReportRow {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key)));
}

/**
 * Assemble le résultat : sans `cost.view`, les colonnes sensibles (coûts, marges, valeur au
 * coût) sont retirées des lignes, des totaux, des chiffres clés et du graphique (B.2).
 */
export function finish(kind: ReportKind, parts: ReportParts, context: ReportContext): ReportResult {
  const hidden = new Set(
    context.canSeeCost ? [] : parts.columns.filter((c) => c.sensitive).map((c) => c.key),
  );
  const rows = context.limit === null ? parts.rows : parts.rows.slice(0, context.limit);
  const chart = parts.chart ?? null;
  return {
    kind,
    generatedAt: context.now.toISOString(),
    columns: parts.columns.filter((c) => !hidden.has(c.key)),
    rows: rows.map((row) => withoutKeys(row, hidden)),
    totals:
      parts.totals === undefined || parts.totals === null
        ? null
        : withoutKeys(parts.totals, hidden),
    summary: (parts.summary ?? [])
      .filter((item) => context.canSeeCost || item.sensitive !== true)
      .map(({ key, type, value }) => ({ key, type, value })),
    chart:
      chart === null
        ? null
        : { ...chart, series: chart.series.filter((series) => !hidden.has(series)) },
    truncated: rows.length < parts.rows.length,
  };
}

/** Marge en pourcentage du chiffre d'affaires HT, à un chiffre après la virgule. */
export function marginRate(margin: number, revenue: number): number | null {
  if (revenue === 0) return null;
  return Math.round((margin * 1000) / revenue) / 10;
}

/** Somme d'une colonne numérique. */
export function sum(rows: readonly ReportRow[], key: string): number {
  return rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === 'number' ? value : 0);
  }, 0);
}
