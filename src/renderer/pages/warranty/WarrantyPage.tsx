import { useCallback, useState } from 'react';
import { Search, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { formatDate } from '@shared/format/date';
import type { Claim, ClaimStatus, Expiring, WarrantyLookup } from '@shared/schemas/inventory';
import { useSubmit } from '../../auth/use-submit';
import { ErrorState, LoadingState } from '../../components/states/states';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormError, SelectField, TextAreaField } from '../../components/ui/form-field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/radix';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { useCan } from '../products/catalog-ui';

const NONE = 'none';

/** Étapes proposées après l'état courant (le service les revérifie). */
const NEXT: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  received: ['sent_to_supplier', 'repaired', 'replaced', 'rejected', 'closed'],
  sent_to_supplier: ['repaired', 'replaced', 'rejected', 'closed'],
  repaired: ['closed'],
  replaced: ['closed'],
  rejected: [],
  closed: [],
};

function claimTone(status: ClaimStatus): 'info' | 'warning' | 'success' | 'neutral' | 'danger' {
  if (status === 'received') return 'info';
  if (status === 'sent_to_supplier') return 'warning';
  if (status === 'repaired' || status === 'replaced') return 'success';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

function useSuppliers() {
  const canSee = useCan('supplier.manage');
  const loader = useCallback(
    () => (canSee ? invoke('suppliers:list') : Promise.resolve([])),
    [canSee],
  );
  return useRemote(loader);
}

function ClaimDialog({
  mode,
  onOpenChange,
  onDone,
}: {
  mode: { kind: 'open'; device: WarrantyLookup } | { kind: 'update'; claim: Claim };
  onOpenChange: (open: boolean) => void;
  onDone: (claim: Claim) => void;
}) {
  const t = useT();
  const suppliers = useSuppliers();
  const { error, submit } = useSubmit();
  const [issue, setIssue] = useState('');
  const [supplier, setSupplier] = useState(NONE);
  const next = mode.kind === 'update' ? NEXT[mode.claim.status] : [];
  const [status, setStatus] = useState<ClaimStatus>(next[0] ?? 'received');
  const [resolution, setResolution] = useState(
    mode.kind === 'update' ? (mode.claim.resolution ?? '') : '',
  );
  const serial = mode.kind === 'open' ? mode.device.serialNumber : mode.claim.serialNumber;
  const supplierOptions = [
    { value: NONE, label: t('claim.form.noSupplier') },
    ...(suppliers.state.status === 'ready' ? suppliers.state.data : []).map((item) => ({
      value: String(item.id),
      label: item.name,
    })),
  ];
  const save = async (): Promise<void> => {
    const supplierId = supplier === NONE ? null : Number(supplier);
    const done = await submit(() =>
      mode.kind === 'open'
        ? invoke('warranty:open', { serialUnitId: mode.device.unitId, issue, supplierId })
        : invoke('warranty:update', { claimId: mode.claim.id, status, resolution, supplierId }),
    );
    if (done !== null) {
      toast.success(t(mode.kind === 'open' ? 'claim.opened' : 'claim.saved'));
      onDone(done.value);
    }
  };
  const expired =
    mode.kind === 'open' && (mode.device.daysLeft === null || mode.device.daysLeft < 0);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('claim.form.title', { serial })}</DialogTitle>
          <DialogDescription>
            {mode.kind === 'open' ? mode.device.productName : mode.claim.issue}
          </DialogDescription>
        </DialogHeader>
        {expired && (
          <p
            role="alert"
            className="bg-warning-soft text-warning-soft-foreground rounded-md px-4 py-3 text-sm font-medium"
          >
            {t('claim.form.expiredWarning')}
          </p>
        )}
        {mode.kind === 'open' ? (
          <TextAreaField
            label={t('claim.form.issue')}
            autoFocus
            rows={3}
            maxLength={1000}
            value={issue}
            onChange={(event) => setIssue(event.target.value)}
          />
        ) : (
          <SelectField
            label={t('claim.form.status')}
            value={status}
            options={next.map((value) => ({ value, label: t(`claim.status.${value}`) }))}
            onValueChange={(value) => setStatus(value as ClaimStatus)}
          />
        )}
        <SelectField
          label={t('claim.form.supplier')}
          value={supplier}
          options={supplierOptions}
          onValueChange={setSupplier}
        />
        {mode.kind === 'update' && (
          <TextAreaField
            label={t('claim.form.resolution')}
            rows={2}
            maxLength={1000}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
          />
        )}
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={mode.kind === 'open' ? issue.trim().length < 3 : next.length === 0}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClaimsTable({ claims, onUpdate }: { claims: Claim[]; onUpdate: (claim: Claim) => void }) {
  const t = useT();
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-muted text-muted-foreground">
        <tr>
          <th scope="col" className="px-4 py-3 font-medium">
            {t('warranty.col.opened')}
          </th>
          <th scope="col" className="px-4 py-3 font-medium">
            {t('warranty.col.device')}
          </th>
          <th scope="col" className="px-4 py-3 font-medium">
            {t('warranty.col.customer')}
          </th>
          <th scope="col" className="px-4 py-3 font-medium">
            {t('warranty.col.issue')}
          </th>
          <th scope="col" className="px-4 py-3 font-medium">
            {t('warranty.col.status')}
          </th>
          <th scope="col" className="px-4 py-3">
            <span className="sr-only">{t('users.col.actions')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {claims.map((claim) => (
          <tr key={claim.id} className="border-border border-t">
            <td className="tabular px-4 py-3">{formatDate(claim.openedAt)}</td>
            <td className="px-4 py-3">
              <span className="block font-medium">{claim.productName}</span>
              <span className="block font-mono text-xs">{claim.serialNumber}</span>
            </td>
            <td className="px-4 py-3">{claim.customerName ?? '—'}</td>
            <td className="px-4 py-3">
              {claim.issue}
              {claim.resolution !== null && (
                <span className="text-muted-foreground block">{claim.resolution}</span>
              )}
            </td>
            <td className="px-4 py-3">
              <span className="flex flex-wrap gap-1">
                <Badge tone={claimTone(claim.status)}>{t(`claim.status.${claim.status}`)}</Badge>
                {claim.warrantyExpired && <Badge tone="warning">{t('warranty.expiredFlag')}</Badge>}
              </span>
            </td>
            <td className="px-4 py-3 text-right">
              {NEXT[claim.status].length > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t('warranty.update', { serial: claim.serialNumber })}
                  onClick={() => onUpdate(claim)}
                >
                  <Wrench aria-hidden="true" />
                </Button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Garantie et SAV simplifié (A.4) : recherche par numéro, réclamations, garanties qui expirent. */
export function WarrantyPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [serial, setSerial] = useState('');
  const [device, setDevice] = useState<WarrantyLookup | null>(null);
  const [searching, setSearching] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: 'open'; device: WarrantyLookup } | { kind: 'update'; claim: Claim } | null
  >(null);
  const claimsLoader = useCallback(
    () => invoke('warranty:list', { scope: 'open', limit: 200 }),
    [],
  );
  const claims = useRemote<Claim[]>(claimsLoader);
  const expiringLoader = useCallback(() => invoke('warranty:expiring'), []);
  const expiring = useRemote<Expiring[]>(expiringLoader);

  const lookup = async (code = serial): Promise<void> => {
    if (code.trim() === '') return;
    setSearching(true);
    try {
      setDevice(await invoke('warranty:lookup', { serial: code }));
    } catch (failure) {
      setDevice(null);
      toast.error(errorMessage(failure));
    }
    setSearching(false);
  };
  const done = (): void => {
    setDialog(null);
    claims.reload();
    if (device !== null) void lookup(device.serialNumber);
  };

  return (
    <>
      <PageHeader title={t('warranty.title')} description={t('warranty.description')} />
      <Tabs defaultValue="search" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="search">{t('warranty.tab.search')}</TabsTrigger>
          <TabsTrigger value="claims">{t('warranty.tab.claims')}</TabsTrigger>
          <TabsTrigger value="expiring">{t('warranty.tab.expiring')}</TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="flex flex-col gap-4">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void lookup();
            }}
          >
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="warranty-serial">{t('warranty.search')}</Label>
              <Input
                id="warranty-serial"
                className="font-mono"
                autoFocus
                autoComplete="off"
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={searching}>
              <Search aria-hidden="true" />
              {t('warranty.searchButton')}
            </Button>
          </form>
          {device !== null && (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <CardTitle>
                    {device.productName} {device.variantLabel}
                  </CardTitle>
                  <p className="font-mono text-sm">
                    {device.serialNumber}
                    {device.imei2 === null ? '' : ` / ${device.imei2}`}
                  </p>
                </div>
                {device.status === 'sold' && (
                  <Button onClick={() => setDialog({ kind: 'open', device })}>
                    <Wrench aria-hidden="true" />
                    {t('warranty.openClaim')}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {device.status !== 'sold' ? (
                  <p className="text-sm">
                    {t('warranty.notSold', { status: t(`serial.${device.status}`) })}
                  </p>
                ) : (
                  <>
                    <p className="text-sm">
                      {t('warranty.sale', {
                        date: device.soldAt === null ? '—' : formatDate(device.soldAt),
                        invoice: device.invoiceNumber ?? '—',
                      })}
                      {device.saleId !== null && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="ml-2"
                          onClick={() => navigate('sales.detail', { saleId: device.saleId ?? 0 })}
                        >
                          {t('nav.sales.detail')}
                        </Button>
                      )}
                    </p>
                    {device.customerName !== null && (
                      <p className="text-sm">
                        {t('warranty.customer', { name: device.customerName })}
                        {device.customerPhone === null ? '' : ` · ${device.customerPhone}`}
                      </p>
                    )}
                    {device.warrantyEnd === null ? (
                      <Badge>{t('warranty.none')}</Badge>
                    ) : (device.daysLeft ?? -1) >= 0 ? (
                      <p className="text-success flex items-center gap-2 text-base font-semibold">
                        <ShieldCheck className="size-5" aria-hidden="true" />
                        {t('warranty.valid', {
                          date: device.warrantyEnd,
                          days: device.daysLeft ?? 0,
                        })}
                      </p>
                    ) : (
                      <p className="text-danger flex items-center gap-2 text-base font-semibold">
                        <ShieldAlert className="size-5" aria-hidden="true" />
                        {t('warranty.expired', { date: device.warrantyEnd })}
                      </p>
                    )}
                  </>
                )}
                <h3 className="text-base font-semibold">{t('warranty.history')}</h3>
                {device.claims.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t('warranty.noClaims')}</p>
                ) : (
                  <ClaimsTable
                    claims={device.claims}
                    onUpdate={(claim) => setDialog({ kind: 'update', claim })}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="claims">
          {claims.state.status === 'loading' && (
            <LoadingState label={t('state.loading')} rows={3} />
          )}
          {claims.state.status === 'error' && (
            <ErrorState
              title={t('warranty.error')}
              message={claims.state.message}
              solution={t('state.preferences.solution')}
              retryLabel={t('state.error.retry')}
              onRetry={claims.reload}
            />
          )}
          {claims.state.status === 'ready' &&
            (claims.state.data.length === 0 ? (
              <p className="text-muted-foreground py-6 text-sm">{t('warranty.noOpen')}</p>
            ) : (
              <Card className="overflow-hidden">
                <ClaimsTable
                  claims={claims.state.data}
                  onUpdate={(claim) => setDialog({ kind: 'update', claim })}
                />
              </Card>
            ))}
        </TabsContent>
        <TabsContent value="expiring">
          {expiring.state.status === 'loading' && (
            <LoadingState label={t('state.loading')} rows={3} />
          )}
          {expiring.state.status === 'error' && (
            <ErrorState
              title={t('warranty.error')}
              message={expiring.state.message}
              solution={t('state.preferences.solution')}
              retryLabel={t('state.error.retry')}
              onRetry={expiring.reload}
            />
          )}
          {expiring.state.status === 'ready' &&
            (expiring.state.data.length === 0 ? (
              <p className="text-muted-foreground py-6 text-sm">{t('warranty.noExpiring')}</p>
            ) : (
              <Card className="overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('warranty.col.device')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('warranty.col.customer')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        {t('warranty.col.end')}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        {t('warranty.col.days')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiring.state.data.map((row) => (
                      <tr key={row.unitId} className="border-border border-t">
                        <td className="px-4 py-3">
                          <span className="block font-medium">{row.productName}</span>
                          <span className="block font-mono text-xs">{row.serialNumber}</span>
                        </td>
                        <td className="px-4 py-3">
                          {row.customerName ?? '—'}
                          {row.phone !== null && (
                            <span className="text-muted-foreground block">{row.phone}</span>
                          )}
                        </td>
                        <td className="tabular px-4 py-3">{row.warrantyEnd}</td>
                        <td className="tabular px-4 py-3 text-right">{row.daysLeft}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
        </TabsContent>
      </Tabs>
      {dialog !== null && (
        <ClaimDialog mode={dialog} onOpenChange={() => setDialog(null)} onDone={done} />
      )}
    </>
  );
}
