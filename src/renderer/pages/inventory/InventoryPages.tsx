import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ClipboardCheck, FileSpreadsheet, FileText, Plus, X } from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import { formatMoney } from '@shared/format/money';
import type {
  InventoryDetail,
  InventoryLine,
  InventoryStatus,
  InventorySummary,
} from '@shared/schemas/inventory';
import { useSubmit } from '../../auth/use-submit';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card, CardContent, Input, Label } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SelectField, TextField } from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { cn } from '../../lib/cn';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { useStockEvents } from '../../stores/stock-events';
import { categoryOptions, useCatalogReferences } from '../products/catalog-ui';
import { beep } from '../pos/pos-ui';

function statusTone(status: InventoryStatus): 'neutral' | 'info' | 'warning' | 'success' {
  if (status === 'counting') return 'info';
  if (status === 'review') return 'warning';
  if (status === 'validated') return 'success';
  return 'neutral';
}

function CreateInventoryDialog({
  onOpenChange,
  onDone,
}: {
  onOpenChange: (open: boolean) => void;
  onDone: (id: number) => void;
}) {
  const t = useT();
  const { state } = useCatalogReferences();
  const { error, submit } = useSubmit();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'all' | 'brand' | 'category'>('all');
  const [scopeId, setScopeId] = useState('');
  const [location, setLocation] = useState<string | null>(null);
  if (state.status !== 'ready') {
    return null;
  }
  const refs = state.data;
  const locationId =
    location ??
    String(
      refs.locations.find((candidate) => candidate.isDefault)?.id ?? refs.locations[0]?.id ?? '',
    );
  const create = async (): Promise<void> => {
    const created = await submit(() =>
      invoke('inventory:create', {
        name,
        scopeType: scope,
        scopeId: scope === 'all' ? null : Number(scopeId),
        locationId: Number(locationId),
      }),
    );
    if (created !== null) onDone(created.value.inventory.id);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('inventory.form.title')}</DialogTitle>
          <DialogDescription>{t('inventory.form.description')}</DialogDescription>
        </DialogHeader>
        <TextField
          label={t('inventory.form.name')}
          autoFocus
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          label={t('inventory.form.scope')}
          value={scope}
          options={(['all', 'brand', 'category'] as const).map((value) => ({
            value,
            label: t(`inventory.form.scope.${value}`),
          }))}
          onValueChange={(value) => {
            setScope(value as typeof scope);
            setScopeId('');
          }}
        />
        {scope === 'brand' && (
          <SelectField
            label={t('inventory.form.brand')}
            value={scopeId}
            options={refs.brands
              .filter((brand) => brand.isActive)
              .map((brand) => ({ value: String(brand.id), label: brand.name }))}
            onValueChange={setScopeId}
          />
        )}
        {scope === 'category' && (
          <SelectField
            label={t('inventory.form.category')}
            value={scopeId}
            options={categoryOptions(refs.categories)}
            onValueChange={setScopeId}
          />
        )}
        <SelectField
          label={t('inventory.form.location')}
          value={locationId}
          options={refs.locations.map((candidate) => ({
            value: String(candidate.id),
            label: candidate.name,
          }))}
          onValueChange={setLocation}
        />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={name.trim() === '' || (scope !== 'all' && scopeId === '')}
            onClick={() => void create()}
          >
            {t('inventory.form.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Inventaires (A.4) : historique et ouverture d'un nouvel inventaire. */
export function InventoriesPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const loader = useCallback(() => invoke('inventory:list', { limit: 100 }), []);
  const { state, reload } = useRemote<InventorySummary[]>(loader);
  const [creating, setCreating] = useState(false);
  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('inventories.new')}
    </Button>
  );
  return (
    <>
      <PageHeader
        title={t('inventories.title')}
        description={t('inventories.description')}
        actions={newButton}
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={4} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('inventories.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title={t('inventories.empty.title')}
          description={t('inventories.empty.description')}
          action={newButton}
        />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('inventories.col.name')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('inventories.col.scope')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('inventories.col.location')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('inventories.col.date')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('inventories.col.progress')}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('inventories.col.differences')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('inventories.col.status')}
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((inventory) => (
                <tr key={inventory.id} className="border-border border-t">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      aria-label={t('inventories.open', { name: inventory.name })}
                      onClick={() => navigate('inventory.detail', { inventoryId: inventory.id })}
                    >
                      {inventory.name}
                    </button>
                  </td>
                  <td className="px-4 py-3">{inventory.scopeLabel}</td>
                  <td className="px-4 py-3">{inventory.locationName}</td>
                  <td className="tabular px-4 py-3">{formatDateTime(inventory.createdAt)}</td>
                  <td className="tabular px-4 py-3 text-right">
                    {t('inventories.progress', {
                      counted: inventory.countedCount,
                      total: inventory.lineCount,
                    })}
                  </td>
                  <td className="tabular px-4 py-3 text-right">{inventory.differenceCount}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(inventory.status)}>
                      {t(`inventory.status.${inventory.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && (
        <CreateInventoryDialog
          onOpenChange={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            navigate('inventory.detail', { inventoryId: id });
          }}
        />
      )}
    </>
  );
}

function Steps({ status }: { status: InventoryStatus }) {
  const t = useT();
  const steps = [
    t('inventory.step.scope'),
    t('inventory.step.count'),
    t('inventory.step.review'),
    t('inventory.step.validate'),
  ];
  const current = status === 'counting' ? 1 : status === 'review' ? 2 : 3;
  return (
    <ol className="flex flex-wrap gap-2" aria-label={t('inventory.steps')}>
      {steps.map((step, index) => {
        const done = index < current || status === 'validated';
        const active = index === current && status !== 'validated' && status !== 'cancelled';
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2 rounded-full border px-3 py-1 text-sm',
              active
                ? 'border-primary bg-primary-soft text-primary-soft-foreground font-semibold'
                : 'border-border',
            )}
          >
            {done ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <span className="tabular">{index + 1}.</span>
            )}
            <span className="sr-only">
              {done
                ? t('inventory.step.done', { step })
                : active
                  ? t('inventory.step.current', { step })
                  : step}
            </span>
            <span aria-hidden="true">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CountInput({
  line,
  onSave,
}: {
  line: InventoryLine;
  onSave: (counted: number | null) => void;
}) {
  const t = useT();
  const [text, setText] = useState(line.counted === null ? '' : String(line.counted));
  const commit = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') {
      if (line.counted !== null) onSave(null);
      return;
    }
    const value = Number(trimmed);
    if (Number.isInteger(value) && value >= 0 && value !== line.counted) onSave(value);
  };
  return (
    <Input
      className="tabular w-24 text-center"
      inputMode="numeric"
      aria-label={t('inventory.counted', { name: line.name })}
      placeholder={t('inventory.notCounted')}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
    />
  );
}

/** Assistant d'inventaire (A.4) : périmètre, comptage au scanner, écarts, validation. */
export function InventoryDetailPage() {
  const t = useT();
  const inventoryId = useRouter((state) => state.params.inventoryId);
  const stockChanged = useStockEvents((state) => state.changed);
  const scanRef = useRef<HTMLInputElement>(null);
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState('');
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'zero' | 'validate' | 'cancel' | null>(null);

  useEffect(() => {
    if (inventoryId === undefined) return;
    let active = true;
    invoke('inventory:get', { inventoryId }).then(
      (found) => {
        if (active) setDetail(found);
      },
      (failure: unknown) => {
        if (active) setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [inventoryId, attempt]);

  if (error !== null) {
    return (
      <ErrorState
        title={t('inventory.error')}
        message={error}
        solution={t('state.preferences.solution')}
        retryLabel={t('state.error.retry')}
        onRetry={() => {
          setError(null);
          setAttempt((v) => v + 1);
        }}
      />
    );
  }
  if (detail === null || inventoryId === undefined)
    return <LoadingState label={t('state.loading')} rows={6} />;
  const { inventory } = detail;
  const run = async (action: () => Promise<InventoryDetail>, success?: string): Promise<void> => {
    try {
      setDetail(await action());
      if (success !== undefined) toast.success(success);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  const scan = async (): Promise<void> => {
    const value = code.trim();
    if (value === '') return;
    try {
      const result = await invoke('inventory:scan', { inventoryId, code: value });
      beep(true);
      setLastScan(
        result.kind === 'unit'
          ? t('inventory.scanned.unit', {
              name: result.name,
              serial: result.serialNumber ?? '',
              counted: result.counted,
            })
          : t('inventory.scanned.item', { name: result.name, counted: result.counted }),
      );
      setDetail(await invoke('inventory:get', { inventoryId }));
    } catch (failure) {
      beep(false);
      setLastScan(null);
      toast.error(errorMessage(failure));
    }
    setCode('');
    scanRef.current?.focus();
  };
  const exportReport = async (format: 'pdf' | 'xlsx'): Promise<void> => {
    try {
      if ((await invoke('inventory:export', { inventoryId, format })).saved)
        toast.success(t('inventory.exported'));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  const counting = inventory.status === 'counting';
  const showExpected = !counting;
  const lines = showExpected
    ? [...detail.lines].sort((a, b) => Math.abs(b.difference ?? 0) - Math.abs(a.difference ?? 0))
    : detail.lines;
  const finished = inventory.status === 'validated' || inventory.status === 'cancelled';

  return (
    <>
      <PageHeader
        title={inventory.name}
        description={`${inventory.scopeLabel} · ${inventory.locationName}`}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Badge tone={statusTone(inventory.status)}>
              {t(`inventory.status.${inventory.status}`)}
            </Badge>
            <Button variant="secondary" onClick={() => void exportReport('pdf')}>
              <FileText aria-hidden="true" />
              {t('inventory.exportPdf')}
            </Button>
            <Button variant="secondary" onClick={() => void exportReport('xlsx')}>
              <FileSpreadsheet aria-hidden="true" />
              {t('inventory.exportXlsx')}
            </Button>
            {!finished && (
              <Button variant="ghost" onClick={() => setConfirm('cancel')}>
                <X aria-hidden="true" />
                {t('inventory.cancel')}
              </Button>
            )}
          </div>
        }
      />
      <Steps status={inventory.status} />
      <p className="text-muted-foreground text-sm">
        {t('inventory.by', {
          date: formatDateTime(inventory.createdAt),
          name: inventory.createdBy,
        })}
        {inventory.validatedAt !== null &&
          ` · ${t('inventory.validatedBy', { date: formatDateTime(inventory.validatedAt), name: inventory.validatedBy ?? '' })}`}
      </p>
      {counting && (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-6">
            <Label htmlFor="inventory-scan">{t('inventory.scan')}</Label>
            <Input
              ref={scanRef}
              id="inventory-scan"
              className="h-12 text-lg"
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                void scan();
              }}
            />
            <p className="text-muted-foreground text-sm">{t('inventory.scanHint')}</p>
            {lastScan !== null && (
              <p role="status" className="text-success text-base font-semibold">
                {lastScan}
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {showExpected && (
        <p className="text-base font-semibold" role="status">
          {inventory.differenceCount === 0
            ? t('inventory.noDifference')
            : inventory.differenceValue === null
              ? t('inventory.summary', { count: inventory.differenceCount })
              : t('inventory.summaryValue', {
                  count: inventory.differenceCount,
                  value: formatMoney(inventory.differenceValue),
                })}
        </p>
      )}
      <Card className="overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                {t('inventory.col.item')}
              </th>
              {showExpected && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('inventory.col.expected')}
                </th>
              )}
              <th scope="col" className="px-4 py-3 text-right font-medium">
                {t('inventory.col.counted')}
              </th>
              {showExpected && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('inventory.col.difference')}
                </th>
              )}
              {showExpected && inventory.differenceValue !== null && (
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t('inventory.col.value')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const tracked = line.trackingMode !== 'none';
              return (
                <tr key={line.id} className="border-border border-t align-top">
                  <td className="px-4 py-3">
                    <span className="block font-medium">
                      {line.name} {line.variantLabel}
                    </span>
                    <span className="text-muted-foreground block font-mono text-xs">
                      {line.barcode ?? line.sku}
                    </span>
                    {tracked && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {line.scanned.map((unit) => (
                          <span
                            key={unit.unitId}
                            className="bg-muted inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-xs"
                          >
                            {unit.serialNumber}
                            {counting && (
                              <button
                                type="button"
                                aria-label={t('inventory.removeScan', {
                                  serial: unit.serialNumber,
                                })}
                                onClick={() =>
                                  void run(() =>
                                    invoke('inventory:removeScan', {
                                      inventoryId,
                                      unitId: unit.unitId,
                                    }),
                                  )
                                }
                              >
                                <X className="size-3" aria-hidden="true" />
                              </button>
                            )}
                          </span>
                        ))}
                      </span>
                    )}
                    {tracked && showExpected && line.missing.length > 0 && (
                      <span className="text-danger mt-1 block font-mono text-xs">
                        {t('inventory.missing', {
                          serials: line.missing.map((unit) => unit.serialNumber).join(', '),
                        })}
                      </span>
                    )}
                  </td>
                  {showExpected && (
                    <td className="tabular px-4 py-3 text-right">{line.expected}</td>
                  )}
                  <td className="tabular px-4 py-3 text-right">
                    {counting && !tracked ? (
                      <CountInput
                        key={`${String(line.id)}:${String(line.counted)}`}
                        line={line}
                        onSave={(counted) =>
                          void run(() =>
                            invoke('inventory:setCount', { inventoryId, lineId: line.id, counted }),
                          )
                        }
                      />
                    ) : tracked && counting ? (
                      t('inventory.units', { count: line.scanned.length })
                    ) : (
                      (line.counted ?? '—')
                    )}
                  </td>
                  {showExpected && (
                    <td
                      className={cn(
                        'tabular px-4 py-3 text-right font-semibold',
                        (line.difference ?? 0) < 0 && 'text-danger',
                        (line.difference ?? 0) > 0 && 'text-success',
                      )}
                    >
                      {line.difference === null
                        ? '—'
                        : line.difference > 0
                          ? `+${String(line.difference)}`
                          : String(line.difference)}
                    </td>
                  )}
                  {showExpected && inventory.differenceValue !== null && (
                    <td className="tabular px-4 py-3 text-right">
                      {line.differenceValue === null || line.differenceValue === 0
                        ? ''
                        : formatMoney(line.differenceValue)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        {counting && (
          <>
            <Button variant="secondary" onClick={() => setConfirm('zero')}>
              {t('inventory.zero')}
            </Button>
            <Button onClick={() => void run(() => invoke('inventory:finish', { inventoryId }))}>
              {t('inventory.finish')}
            </Button>
          </>
        )}
        {inventory.status === 'review' && (
          <>
            <Button
              variant="secondary"
              onClick={() => void run(() => invoke('inventory:resume', { inventoryId }))}
            >
              {t('inventory.resume')}
            </Button>
            <Button
              variant="success"
              disabled={!detail.canValidate}
              onClick={() => setConfirm('validate')}
            >
              {t('inventory.validate')}
            </Button>
          </>
        )}
      </div>
      {inventory.status === 'review' && !detail.canValidate && (
        <p className="text-muted-foreground text-right text-sm">{t('inventory.cannotValidate')}</p>
      )}
      {confirm !== null && (
        <ConfirmDialog
          open
          tone={confirm === 'validate' ? 'primary' : 'danger'}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={t(
            confirm === 'zero'
              ? 'inventory.zero.title'
              : confirm === 'validate'
                ? 'inventory.validate.title'
                : 'inventory.cancel.title',
          )}
          description={t(
            confirm === 'zero'
              ? 'inventory.zero.description'
              : confirm === 'validate'
                ? 'inventory.validate.description'
                : 'inventory.cancel.description',
          )}
          confirmLabel={t(
            confirm === 'zero'
              ? 'inventory.zero'
              : confirm === 'validate'
                ? 'inventory.validate'
                : 'inventory.cancel',
          )}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            const action = confirm;
            setConfirm(null);
            if (action === 'zero')
              void run(() => invoke('inventory:zeroUncounted', { inventoryId }));
            if (action === 'cancel')
              void run(() => invoke('inventory:cancel', { inventoryId }), t('inventory.cancelled'));
            if (action === 'validate') {
              void run(
                () => invoke('inventory:validate', { inventoryId }),
                t('inventory.validated'),
              ).then(stockChanged);
            }
          }}
        />
      )}
    </>
  );
}
