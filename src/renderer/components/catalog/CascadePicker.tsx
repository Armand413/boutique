import { useEffect, useMemo, useState } from 'react';
import { formatMoney } from '@shared/format/money';
import type { Category, ProductRow } from '@shared/schemas/catalog';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { SelectField } from '../ui/form-field';
import { toast } from '../ui/toast';

/** Nombre d'articles proposés dans la dernière liste : au-delà, on affine par catégorie. */
const ARTICLE_LIMIT = 200;
const LEVEL_LABELS = ['cascade.family', 'cascade.category', 'cascade.subcategory'] as const;

export interface CascadePickerProps {
  onPick: (row: ProductRow) => void;
  /** Kits exclus (composition d'un kit, articles stockés). */
  excludeKits?: boolean;
  /** N'affiche que les articles qui ont un stock propre (ni service ni kit). */
  stockedOnly?: boolean;
  /** Prix de vente et stock dans la liste des articles (caisse, devis). */
  showPrice?: boolean;
}

function articleLabel(row: ProductRow, showPrice: boolean, t: ReturnType<typeof useT>): string {
  const name = row.variantLabel === '' ? row.name : `${row.name} · ${row.variantLabel}`;
  if (!showPrice) return name;
  const stock = row.isStocked ? t('cascade.stock', { count: row.stock }) : t('pos.service');
  return `${name} — ${formatMoney(row.salePrice)} (${stock})`;
}

/**
 * Choix d'un article par listes déroulantes successives (demande du client, D91) : famille, puis
 * catégorie et sous-catégorie si elles existent, puis l'article (une ligne par variante). Les
 * articles proposés sont ceux du niveau choisi, sous-catégories comprises : on peut s'arrêter à
 * tout moment. Après un choix, la liste des articles se vide et reste prête pour le suivant.
 */
export function CascadePicker({
  onPick,
  excludeKits = false,
  stockedOnly = false,
  showPrice = false,
}: CascadePickerProps) {
  const t = useT();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [path, setPath] = useState<number[]>([]);
  const [articles, setArticles] = useState<{
    categoryId: number;
    rows: ProductRow[];
    total: number;
  }>({ categoryId: 0, rows: [], total: 0 });

  useEffect(() => {
    let active = true;
    invoke('catalog:references').then(
      (references) => {
        if (active) setCategories(references.categories.filter((category) => category.isActive));
      },
      (error: unknown) => {
        if (active) toast.error(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const current = path.at(-1);
  useEffect(() => {
    if (current === undefined) return;
    let active = true;
    invoke('products:search', {
      categoryId: current,
      status: 'active',
      excludeKits: excludeKits || stockedOnly,
      sort: 'name',
      offset: 0,
      limit: ARTICLE_LIMIT,
    }).then(
      (result) => {
        if (!active) return;
        const rows = stockedOnly ? result.rows.filter((row) => row.isStocked) : result.rows;
        setArticles({ categoryId: current, rows, total: result.total });
      },
      (error: unknown) => {
        if (active) toast.error(errorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [current, excludeKits, stockedOnly]);

  const childrenOf = useMemo(() => {
    const map = new Map<number | null, Category[]>();
    for (const category of categories ?? []) {
      const siblings = map.get(category.parentId) ?? [];
      siblings.push(category);
      map.set(category.parentId, siblings);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'fr'));
    }
    return map;
  }, [categories]);

  // Une liste par niveau : les familles, puis les enfants de chaque catégorie choisie qui en a.
  const levels: { parentId: number | null; options: Category[] }[] = [];
  const families = childrenOf.get(null) ?? [];
  levels.push({ parentId: null, options: families });
  for (const selected of path) {
    const children = childrenOf.get(selected) ?? [];
    if (children.length === 0) break;
    levels.push({ parentId: selected, options: children });
  }

  const choose = (level: number, value: string): void => {
    setPath((previous) => {
      const kept = previous.slice(0, level);
      // « Tous les articles » d'un niveau : on reste sur la catégorie parente.
      return value === '' || value === 'all' ? kept : [...kept, Number(value)];
    });
  };
  const loaded = current !== undefined && articles.categoryId === current;
  const rows = loaded ? articles.rows : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        {levels.map((level, index) => (
          <SelectField
            key={level.parentId ?? 'familles'}
            label={t(LEVEL_LABELS[Math.min(index, LEVEL_LABELS.length - 1)] ?? 'cascade.category')}
            value={path[index] === undefined ? (index === 0 ? '' : 'all') : String(path[index])}
            placeholder={t('cascade.chooseFamily')}
            options={[
              ...(index === 0 ? [] : [{ value: 'all', label: t('cascade.allArticles') }]),
              ...level.options.map((category) => ({
                value: String(category.id),
                label: category.name,
              })),
            ]}
            onValueChange={(value) => choose(index, value)}
          />
        ))}
        {current !== undefined && (
          <SelectField
            key={`articles-${String(current)}`}
            label={t('cascade.article')}
            value=""
            placeholder={
              !loaded
                ? t('state.loading')
                : rows.length === 0
                  ? t('cascade.empty')
                  : t('cascade.chooseArticle', { count: rows.length })
            }
            disabled={!loaded || rows.length === 0}
            options={rows.map((row) => ({
              value: String(row.variantId),
              label: articleLabel(row, showPrice, t),
            }))}
            onValueChange={(value) => {
              const row = rows.find((candidate) => String(candidate.variantId) === value);
              if (row !== undefined) onPick(row);
            }}
            {...(loaded && articles.total > ARTICLE_LIMIT
              ? { hint: t('cascade.tooMany', { count: ARTICLE_LIMIT }) }
              : {})}
          />
        )}
      </div>
    </div>
  );
}
