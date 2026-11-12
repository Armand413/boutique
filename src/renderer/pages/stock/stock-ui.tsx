import { useCallback, useId, useState } from 'react';
import type { ProductRow } from '@shared/schemas/catalog';
import { MOVEMENT_TYPES, PAYMENT_METHODS, type AvailableUnit } from '@shared/schemas/stock';
import { CascadePicker } from '../../components/catalog/CascadePicker';
import { Input, Label } from '../../components/ui/basic';
import type { SelectOption } from '../../components/ui/radix';
import { toast } from '../../components/ui/toast';
import { useT, type Translate } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';

export function useLocations() {
  const loader = useCallback(() => invoke('locations:list'), []);
  return useRemote(loader);
}

export function movementOptions(t: Translate): SelectOption[] {
  return MOVEMENT_TYPES.map((type) => ({ value: type, label: t(`movement.${type}`) }));
}

export function paymentOptions(t: Translate): SelectOption[] {
  return PAYMENT_METHODS.map((method) => ({ value: method, label: t(`payment.${method}`) }));
}

export function rowName(row: Pick<ProductRow, 'name' | 'variantLabel'>): string {
  return [row.name, row.variantLabel].filter((part) => part !== '').join(' · ');
}

/** Date du jour au format AAAA-MM-JJ (heure locale du poste). */
export function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Quantité saisie : entier strictement positif, sinon null. */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) && Number(trimmed) > 0 && Number(trimmed) <= 100_000
    ? Number(trimmed)
    : null;
}

/** Numéros saisis, un par ligne : « IMEI1 IMEI2 » (séparés par espace, virgule ou point-virgule). */
export function parseSerialLines(text: string): { serialNumber: string; imei2: string | null }[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [serialNumber = '', imei2] = line.split(/[\s,;]+/);
      return { serialNumber, imei2: imei2 === undefined || imei2 === '' ? null : imei2 };
    });
}

/**
 * Choix d'un article (D91) : listes successives famille, catégorie, article, plus un petit champ
 * pour le lecteur de codes-barres (code-barres ou référence exacts, puis Entrée).
 */
export function VariantPicker({
  onPick,
  autoFocus,
  includeAll = false,
}: {
  onPick: (row: ProductRow) => void;
  autoFocus?: boolean;
  /** Tous les articles (kits et services compris), pas seulement ceux qui ont du stock. */
  includeAll?: boolean;
}) {
  const t = useT();
  const inputId = useId();
  const [code, setCode] = useState('');

  const scan = async (): Promise<void> => {
    const text = code.trim();
    if (text === '') return;
    try {
      const found = await invoke('products:search', {
        query: text,
        status: 'active',
        excludeKits: !includeAll,
        sort: 'name',
        offset: 0,
        limit: 8,
      });
      const exact = found.rows.find(
        (row) =>
          (row.barcode === text || row.sku.toLowerCase() === text.toLowerCase()) &&
          (includeAll || row.isStocked),
      );
      if (exact === undefined) {
        toast.error(t('picker.noResult'));
        return;
      }
      onPick(exact);
      setCode('');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base font-semibold">{t('picker.label')}</p>
      <CascadePicker onPick={onPick} stockedOnly={!includeAll} showPrice={includeAll} />
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>{t('picker.scanLabel')}</Label>
        <Input
          id={inputId}
          autoComplete="off"
          autoFocus={autoFocus}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void scan();
          }}
        />
      </div>
    </div>
  );
}

/** Choix des unités suivies présentes à un emplacement (sorties, transferts, retours). */
export function UnitPicker({
  variantId,
  locationId,
  required,
  selected,
  onChange,
}: {
  variantId: number;
  locationId: number;
  required: number;
  selected: readonly number[];
  onChange: (ids: number[]) => void;
}) {
  const t = useT();
  const loader = useCallback(
    () => invoke('stock:units', { variantId, locationId }),
    [variantId, locationId],
  );
  const { state } = useRemote<AvailableUnit[]>(loader);
  if (state.status === 'loading') return <p className="text-sm">{t('state.loading')}</p>;
  if (state.status === 'error')
    return (
      <p role="alert" className="text-danger text-sm">
        {state.message}
      </p>
    );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        {t('units.label', { selected: selected.length, required })}
      </legend>
      {state.data.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('units.empty')}</p>
      )}
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {state.data.map((unit) => (
          <li key={unit.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              id={`unit-${String(unit.id)}`}
              className="accent-primary size-5"
              checked={selected.includes(unit.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, unit.id]
                    : selected.filter((id) => id !== unit.id),
                )
              }
            />
            <label htmlFor={`unit-${String(unit.id)}`} className="font-mono text-sm">
              {unit.serialNumber}
              {unit.imei2 === null ? '' : ` / ${unit.imei2}`}
              {unit.status === 'in_stock' ? '' : ` (${t(`serial.${unit.status}`)})`}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
