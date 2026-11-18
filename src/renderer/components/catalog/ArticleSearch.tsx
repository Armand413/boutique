import { useEffect, useId, useState, type KeyboardEvent, type Ref } from 'react';
import { formatMoney } from '@shared/format/money';
import type { ProductRow } from '@shared/schemas/catalog';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { cn } from '../../lib/cn';
import { Input, Label } from '../ui/basic';
import { toast } from '../ui/toast';

/** Suggestions affichées sous le champ ; au-delà, on précise la saisie. */
const SUGGESTION_LIMIT = 8;
/** Saisie minimale avant de chercher, et attente après la dernière frappe (un scanner tape vite). */
const MIN_LENGTH = 2;
const DEBOUNCE_MS = 150;

export interface ArticleSearchProps {
  value: string;
  onValueChange: (value: string) => void;
  onPick: (row: ProductRow) => void;
  /**
   * Entrée sans suggestion sélectionnée (lecteur de codes-barres) : action propre à l'écran. Par
   * défaut, l'article dont le code-barres ou la référence est exactement la saisie, sinon l'unique
   * suggestion.
   */
  onEnter?: (text: string) => void;
  excludeKits?: boolean;
  /** N'affiche que les articles qui ont un stock propre (ni service ni kit). */
  stockedOnly?: boolean;
  /** Prix de vente et stock dans les suggestions (caisse, devis). */
  showPrice?: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

function suggestionText(row: ProductRow, showPrice: boolean, t: ReturnType<typeof useT>) {
  const name = row.variantLabel === '' ? row.name : `${row.name} · ${row.variantLabel}`;
  const detail = [row.brandName, row.sku]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
  if (!showPrice) return { name, detail };
  const stock = row.isStocked ? t('cascade.stock', { count: row.stock }) : t('pos.service');
  return { name, detail: `${detail} — ${formatMoney(row.salePrice)} (${stock})` };
}

/**
 * Recherche d'un article par nom, marque, modèle, référence ou code-barres (D99), à côté des listes
 * Famille › Catégorie › Article. Les suggestions se parcourent au clavier (flèches, Entrée, Échap) ;
 * Entrée sans suggestion choisie sert au lecteur de codes-barres.
 */
export function ArticleSearch({
  value,
  onValueChange,
  onPick,
  onEnter,
  excludeKits = false,
  stockedOnly = false,
  showPrice = false,
  autoFocus = false,
  inputRef,
}: ArticleSearchProps) {
  const t = useT();
  const id = useId();
  const listId = `${id}-suggestions`;
  const text = value.trim();
  const [found, setFound] = useState<{ text: string; rows: ProductRow[] }>({ text: '', rows: [] });
  const [active, setActive] = useState(-1);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (text.length < MIN_LENGTH) return;
    let current = true;
    const timer = window.setTimeout(() => {
      invoke('products:search', {
        query: text,
        status: 'active',
        excludeKits: excludeKits || stockedOnly,
        sort: 'name',
        offset: 0,
        limit: SUGGESTION_LIMIT,
      }).then(
        (result) => {
          if (!current) return;
          const rows = stockedOnly ? result.rows.filter((row) => row.isStocked) : result.rows;
          setFound({ text, rows });
          setActive(-1);
        },
        (error: unknown) => {
          if (current) toast.error(errorMessage(error));
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [text, excludeKits, stockedOnly]);

  const rows = text.length >= MIN_LENGTH && found.text === text ? found.rows : [];
  const open = !closed && text.length >= MIN_LENGTH && found.text === text;

  const pick = (row: ProductRow): void => {
    onPick(row);
    onValueChange('');
    setFound({ text: '', rows: [] });
    setActive(-1);
  };

  const enter = (): void => {
    const selected = rows[active];
    if (open && selected !== undefined) {
      pick(selected);
      return;
    }
    if (text === '') return;
    if (onEnter !== undefined) {
      onEnter(text);
      return;
    }
    const exact = rows.find(
      (row) => row.barcode === text || row.sku.toLowerCase() === text.toLowerCase(),
    );
    const only = rows.length === 1 ? rows[0] : undefined;
    const chosen = exact ?? only;
    if (chosen !== undefined) pick(chosen);
    else toast.error(t('search.noResult'));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && rows.length > 0) {
      event.preventDefault();
      setClosed(false);
      setActive((index) => (index + 1) % rows.length);
    } else if (event.key === 'ArrowUp' && rows.length > 0) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? rows.length - 1 : index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      enter();
    } else if (event.key === 'Escape' && open) {
      // Ferme les suggestions sans déclencher l'Échap de l'écran (annuler la vente).
      event.preventDefault();
      event.stopPropagation();
      setClosed(true);
      setActive(-1);
    }
  };

  return (
    <div className="relative flex flex-col gap-2">
      <Label htmlFor={id}>{t('search.label')}</Label>
      <Input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        {...(open && active >= 0 ? { 'aria-activedescendant': `${listId}-${String(active)}` } : {})}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={t('search.placeholder')}
        value={value}
        onChange={(event) => {
          setClosed(false);
          onValueChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setClosed(true)}
        onFocus={() => setClosed(false)}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('search.suggestions')}
          className="border-border bg-surface absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-md border shadow-lg"
        >
          {rows.length === 0 ? (
            <li role="presentation" className="text-muted-foreground px-3 py-2 text-sm">
              {t('search.noResult')}
            </li>
          ) : (
            rows.map((row, index) => {
              const { name, detail } = suggestionText(row, showPrice, t);
              return (
                <li
                  key={row.variantId}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    'hover:bg-muted flex cursor-pointer flex-col px-3 py-2',
                    index === active && 'bg-muted',
                  )}
                  // Garde le focus dans le champ : le clic choisit sans fermer la liste avant.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(row)}
                >
                  <span className="text-sm font-medium">{name}</span>
                  {detail !== '' && <span className="text-muted-foreground text-xs">{detail}</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
