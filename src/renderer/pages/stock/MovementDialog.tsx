import { useState } from 'react';
import type { ProductRow } from '@shared/schemas/catalog';
import { MANUAL_EXIT_TYPES, type Location } from '@shared/schemas/stock';
import { useSubmit } from '../../auth/use-submit';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SelectField, TextAreaField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { useStockEvents } from '../../stores/stock-events';
import { parseQuantity, parseSerialLines, rowName, UnitPicker, VariantPicker } from './stock-ui';

type ExitType = (typeof MANUAL_EXIT_TYPES)[number] | 'adjustment';

export type MovementMode =
  | { kind: 'exit' }
  | { kind: 'transfer' }
  | { kind: 'return'; supplierId: number; supplierName: string };

interface MovementDialogProps {
  mode: MovementMode;
  locations: readonly Location[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** Sortie ou ajustement, transfert entre emplacements, ou retour au fournisseur (4.3). */
export function MovementDialog({ mode, locations, onOpenChange, onDone }: MovementDialogProps) {
  const t = useT();
  const { error, submit } = useSubmit();
  const stockChanged = useStockEvents((state) => state.changed);
  const active = locations.filter((location) => location.isActive);
  const defaultLocation = String(
    active.find((location) => location.isDefault)?.id ?? active[0]?.id ?? '',
  );
  const [item, setItem] = useState<ProductRow | null>(null);
  const [locationId, setLocationId] = useState(defaultLocation);
  const [toLocationId, setToLocationId] = useState(
    String(active.find((location) => String(location.id) !== defaultLocation)?.id ?? ''),
  );
  const [type, setType] = useState<ExitType>('loss');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [quantityText, setQuantityText] = useState('1');
  const [reason, setReason] = useState('');
  const [serialText, setSerialText] = useState('');
  const [unitIds, setUnitIds] = useState<number[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{ quantity?: string; reason?: string }>({});
  const [saving, setSaving] = useState(false);

  const tracked = item !== null && item.trackingMode !== 'none';
  const adding = mode.kind === 'exit' && type === 'adjustment' && direction === 'in';
  const quantity = parseQuantity(quantityText);
  const locationOptions = active.map((location) => ({
    value: String(location.id),
    label: location.name,
  }));
  const title =
    mode.kind === 'exit'
      ? t('exit.title')
      : mode.kind === 'transfer'
        ? t('transfer.title')
        : t('return.title');
  const description =
    mode.kind === 'exit'
      ? t('exit.description')
      : mode.kind === 'transfer'
        ? t('transfer.description')
        : `${mode.supplierName} · ${t('return.description')}`;

  const save = async (): Promise<void> => {
    if (item === null) return;
    const errors: { quantity?: string; reason?: string } = {};
    if (quantity === null) errors.quantity = t('form.invalidQuantity');
    if (mode.kind !== 'transfer' && reason.trim().length < 3) errors.reason = t('form.reasonShort');
    setFieldErrors(errors);
    if (quantity === null || Object.keys(errors).length > 0) return;
    const serials = tracked && adding ? { serials: parseSerialLines(serialText) } : {};
    const units = tracked && !adding ? { serialUnitIds: unitIds } : {};
    setSaving(true);
    const result = await submit(async () => {
      if (mode.kind === 'exit') {
        await invoke('stock:exit', {
          variantId: item.variantId,
          locationId: Number(locationId),
          type,
          direction: type === 'adjustment' ? direction : 'out',
          quantity,
          reason,
          ...serials,
          ...units,
        });
      } else if (mode.kind === 'transfer') {
        await invoke('stock:transfer', {
          variantId: item.variantId,
          fromLocationId: Number(locationId),
          toLocationId: Number(toLocationId),
          quantity,
          reason,
          ...units,
        });
      } else {
        await invoke('suppliers:return', {
          supplierId: mode.supplierId,
          variantId: item.variantId,
          locationId: Number(locationId),
          quantity,
          reason,
          ...units,
        });
      }
    });
    setSaving(false);
    if (result !== null) {
      stockChanged();
      toast.success(
        t(
          mode.kind === 'exit'
            ? 'exit.saved'
            : mode.kind === 'transfer'
              ? 'transfer.saved'
              : 'return.saved',
        ),
      );
      onDone();
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {item === null ? (
          <VariantPicker
            autoFocus
            onPick={(row) => {
              setItem(row);
              setUnitIds([]);
            }}
          />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-medium">{t('picker.selected', { name: rowName(item) })}</p>
            <Button size="sm" variant="ghost" onClick={() => setItem(null)}>
              {t('picker.change')}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label={mode.kind === 'transfer' ? t('transfer.from') : t('stock.filter.location')}
            value={locationId}
            options={locationOptions}
            onValueChange={(value) => {
              setLocationId(value);
              setUnitIds([]);
            }}
          />
          {mode.kind === 'transfer' && (
            <SelectField
              label={t('transfer.to')}
              value={toLocationId}
              options={locationOptions}
              onValueChange={setToLocationId}
            />
          )}
          {mode.kind === 'exit' && (
            <SelectField
              label={t('exit.type')}
              value={type}
              options={[...MANUAL_EXIT_TYPES, 'adjustment' as const].map((value) => ({
                value,
                label: t(`movement.${value}`),
              }))}
              onValueChange={(value) => {
                setType(value as ExitType);
                if (value !== 'adjustment') setDirection('out');
              }}
            />
          )}
          {mode.kind === 'exit' && type === 'adjustment' && (
            <SelectField
              label={t('exit.direction')}
              value={direction}
              options={[
                { value: 'out', label: t('exit.direction.out') },
                { value: 'in', label: t('exit.direction.in') },
              ]}
              onValueChange={(value) => setDirection(value === 'in' ? 'in' : 'out')}
            />
          )}
          <TextField
            label={t('exit.quantity')}
            inputMode="numeric"
            value={quantityText}
            error={fieldErrors.quantity}
            onChange={(event) => setQuantityText(event.target.value)}
          />
        </div>
        {item !== null && tracked && !adding && locationId !== '' && (
          <UnitPicker
            key={`${String(item.variantId)}-${locationId}`}
            variantId={item.variantId}
            locationId={Number(locationId)}
            required={quantity ?? 0}
            selected={unitIds}
            onChange={setUnitIds}
          />
        )}
        {tracked && adding && (
          <TextAreaField
            label={t('exit.serials')}
            hint={t('exit.serialsHint')}
            rows={4}
            className="font-mono"
            value={serialText}
            onChange={(event) => setSerialText(event.target.value)}
          />
        )}
        {mode.kind === 'transfer' ? (
          <TextField
            label={t('transfer.reason')}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        ) : (
          <TextAreaField
            label={t('exit.reason')}
            hint={t('exit.reasonHint')}
            maxLength={500}
            rows={2}
            error={fieldErrors.reason}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={item === null || saving}>
            {mode.kind === 'transfer' ? t('transfer.save') : t('exit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
