import { useState } from 'react';
import { ImagePlus, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { formatMoney, parseMoney } from '@shared/format/money';
import type { AllSettings } from '@shared/schemas/settings';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  CheckboxField,
  FormError,
  SelectField,
  TextAreaField,
  TextField,
} from '../../components/ui/form-field';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { usePublicSettings } from '../../stores/public-settings';
import { intOrNull, parsePercent, percentText, saveSection, SettingsShell } from './settings-ui';

type Update = (next: AllSettings) => void;

function SaveBar({ disabled, onSave }: { disabled?: boolean; onSave: () => void }) {
  const t = useT();
  return (
    <div className="flex justify-end">
      <Button disabled={disabled} onClick={onSave}>
        {t('settings.save')}
      </Button>
    </div>
  );
}

function ShopForm({ settings, update }: { settings: AllSettings; update: Update }) {
  const t = useT();
  const reloadPublic = usePublicSettings((state) => state.load);
  const [shop, setShop] = useState(settings.shop);
  const field = (key: keyof typeof shop) => ({
    value: shop[key] ?? '',
    onChange: (event: { target: { value: string } }) =>
      setShop({ ...shop, [key]: event.target.value }),
  });
  const save = async () => {
    const saved = await saveSection(() => invoke('settings:saveShop', shop), t('settings.saved'));
    if (saved !== null) {
      update(saved);
      void reloadPublic();
    }
  };
  const logo = async (remove: boolean) => {
    try {
      const saved = remove
        ? await invoke('settings:removeLogo')
        : await invoke('settings:chooseLogo');
      if (saved !== null) update(saved);
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardContent className="flex flex-col gap-4 pt-6">
          <TextField label={t('shop.name')} maxLength={120} {...field('name')} />
          <TextAreaField label={t('shop.address')} rows={2} maxLength={300} {...field('address')} />
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={t('shop.phone')} maxLength={40} {...field('phone')} />
            <TextField label={t('shop.email')} type="email" maxLength={120} {...field('email')} />
          </div>
          <TextAreaField
            label={t('shop.legal')}
            hint={t('shop.legalHint')}
            rows={2}
            maxLength={500}
            {...field('legal')}
          />
          <SaveBar disabled={shop.name.trim() === ''} onSave={() => void save()} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('shop.logo')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          {settings.logo === null ? (
            <p className="text-muted-foreground text-sm">{t('shop.logoNone')}</p>
          ) : (
            <img
              src={settings.logo}
              alt={t('shop.logoAlt')}
              className="border-border max-h-24 rounded border bg-white p-2"
            />
          )}
          <p className="text-muted-foreground text-sm">{t('shop.logoHint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void logo(false)}>
              <ImagePlus aria-hidden="true" />
              {t('shop.logoChoose')}
            </Button>
            {settings.logo !== null && (
              <Button variant="ghost" onClick={() => void logo(true)}>
                <Trash2 aria-hidden="true" />
                {t('shop.logoRemove')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function ShopSettingsPage() {
  const t = useT();
  return (
    <SettingsShell title={t('nav.settings.shop')} description={t('settings.shop.description')}>
      {(settings, update) => <ShopForm settings={settings} update={update} />}
    </SettingsShell>
  );
}

function RegionalForm({ settings, update }: { settings: AllSettings; update: Update }) {
  const t = useT();
  const reloadPublic = usePublicSettings((state) => state.load);
  const [regional, setRegional] = useState(settings.regional);
  const currency = regional.currency;
  const setCurrency = (patch: Partial<typeof currency>) =>
    setRegional({ ...regional, currency: { ...currency, ...patch } });
  const save = async () => {
    const saved = await saveSection(
      () => invoke('settings:saveRegional', regional),
      t('settings.saved'),
    );
    if (saved !== null) {
      update(saved);
      await reloadPublic();
    }
  };
  const valid =
    /^[A-Z]{3}$/.test(currency.code) &&
    currency.symbol.trim() !== '' &&
    /^[A-Z0-9]{1,8}$/.test(regional.invoicePrefix);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <div className="grid gap-4 md:grid-cols-3">
          <TextField
            label={t('regional.currencyCode')}
            maxLength={3}
            value={currency.code}
            onChange={(event) => setCurrency({ code: event.target.value.toUpperCase() })}
          />
          <TextField
            label={t('regional.currencySymbol')}
            maxLength={8}
            value={currency.symbol}
            onChange={(event) => setCurrency({ symbol: event.target.value })}
          />
          <SelectField
            label={t('regional.decimals')}
            value={String(currency.decimals)}
            disabled={settings.decimalsLocked}
            hint={settings.decimalsLocked ? t('regional.decimalsLocked') : undefined}
            options={['0', '2', '3'].map((value) => ({ value, label: value }))}
            onValueChange={(value) => setCurrency({ decimals: Number(value) })}
          />
        </div>
        <p className="text-muted-foreground text-sm">
          {t('regional.preview', {
            amount: formatMoney(1_250_000, currency.symbol === '' ? undefined : currency),
          })}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('regional.dateFormat')}
            value={regional.dateFormat}
            options={(['fr', 'iso'] as const).map((value) => ({
              value,
              label: t(`regional.dateFormat.${value}`),
            }))}
            onValueChange={(value) =>
              setRegional({ ...regional, dateFormat: value as 'fr' | 'iso' })
            }
          />
          <TextField
            label={t('regional.invoicePrefix')}
            maxLength={8}
            hint={t('regional.invoiceHint', {
              example: `${regional.invoicePrefix}-${String(new Date().getFullYear())}-000123`,
            })}
            value={regional.invoicePrefix}
            onChange={(event) =>
              setRegional({ ...regional, invoicePrefix: event.target.value.toUpperCase() })
            }
          />
        </div>
        <SaveBar disabled={!valid} onSave={() => void save()} />
      </CardContent>
    </Card>
  );
}

export function RegionalSettingsPage() {
  const t = useT();
  return (
    <SettingsShell
      title={t('nav.settings.regional')}
      description={t('settings.regional.description')}
    >
      {(settings, update) => <RegionalForm settings={settings} update={update} />}
    </SettingsShell>
  );
}

type TaxRate = AllSettings['taxRates'][number];

function TaxDialog({
  rate,
  onClose,
  onSaved,
}: {
  rate: TaxRate | null;
  onClose: () => void;
  onSaved: Update;
}) {
  const t = useT();
  const [name, setName] = useState(rate?.name ?? '');
  const [value, setValue] = useState(rate === null ? '' : percentText(rate.rate));
  const [active, setActive] = useState(rate?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const basisPoints = parsePercent(value);
    if (basisPoints === null) {
      setError(t('security.invalidNumber'));
      return;
    }
    try {
      onSaved(
        await invoke('settings:saveTaxRate', {
          id: rate?.id ?? null,
          name,
          rate: basisPoints,
          isActive: active,
        }),
      );
      toast.success(t('settings.saved'));
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {rate === null ? t('taxes.new') : t('taxes.edit', { name: rate.name })}
          </DialogTitle>
        </DialogHeader>
        <TextField
          label={t('taxes.name')}
          autoFocus
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t('taxes.rate')}
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <CheckboxField
          label={t('taxes.active')}
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        <FormError message={error} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={name.trim() === ''} onClick={() => void save()}>
            {t('settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaxesSettingsPage() {
  const t = useT();
  const [editing, setEditing] = useState<TaxRate | null | 'new'>(null);
  return (
    <SettingsShell title={t('nav.settings.taxes')} description={t('settings.taxes.description')}>
      {(settings, update) => (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-muted-foreground text-sm">{t('taxes.hint')}</p>
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden="true" />
              {t('taxes.new')}
            </Button>
          </div>
          <Card className="overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('taxes.col.name')}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t('taxes.col.rate')}
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    {t('taxes.col.status')}
                  </th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">{t('users.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {settings.taxRates.map((rate) => (
                  <tr key={rate.id} className="border-border border-t">
                    <td className="px-4 py-3 font-medium">{rate.name}</td>
                    <td className="tabular px-4 py-3 text-right">{percentText(rate.rate)} %</td>
                    <td className="px-4 py-3">
                      <Badge tone={rate.isActive ? 'success' : 'neutral'}>
                        {rate.isActive ? t('taxes.activeBadge') : t('taxes.inactive')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t('taxes.edit', { name: rate.name })}
                        onClick={() => setEditing(rate)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {editing !== null && (
            <TaxDialog
              rate={editing === 'new' ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={update}
            />
          )}
        </div>
      )}
    </SettingsShell>
  );
}

function PrintingForm({ settings, update }: { settings: AllSettings; update: Update }) {
  const t = useT();
  const reloadPublic = usePublicSettings((state) => state.load);
  const [printer, setPrinter] = useState(settings.printer);
  const [host, setHost] = useState(settings.printer.receipt?.host ?? '');
  const [port, setPort] = useState(String(settings.printer.receipt?.port ?? 9100));
  const network = printer.receipt !== null;
  const payload = () => ({
    ...printer,
    receipt: network ? { host: host.trim(), port: intOrNull(port, 1, 65535) ?? 0 } : null,
  });
  const save = async (): Promise<boolean> => {
    const saved = await saveSection(
      () => invoke('settings:savePrinter', payload()),
      t('settings.saved'),
    );
    if (saved === null) return false;
    update(saved);
    void reloadPublic();
    return true;
  };
  const test = async () => {
    if (!(await save())) return;
    try {
      const result = await invoke('settings:testPrint');
      toast.success(result.simulated ? t('printing.testedSimulated') : t('printing.tested'));
    } catch (failure) {
      toast.error(errorMessage(failure));
    }
  };
  const valid =
    !network || (/^[\w.-]{1,253}$/.test(host.trim()) && intOrNull(port, 1, 65535) !== null);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <SelectField
          label={t('printing.mode')}
          value={network ? 'network' : 'simulator'}
          options={(['simulator', 'network'] as const).map((value) => ({
            value,
            label: t(`printing.mode.${value}`),
          }))}
          onValueChange={(value) =>
            setPrinter({ ...printer, receipt: value === 'network' ? { host, port: 9100 } : null })
          }
        />
        {network && (
          <div className="grid gap-4 md:grid-cols-[1fr_10rem]">
            <TextField
              label={t('printing.host')}
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
            <TextField
              label={t('printing.port')}
              inputMode="numeric"
              value={port}
              onChange={(event) => setPort(event.target.value)}
            />
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('printing.width')}
            value={String(printer.receiptWidth)}
            options={(['32', '48'] as const).map((value) => ({
              value,
              label: t(`printing.width.${value}`),
            }))}
            onValueChange={(value) =>
              setPrinter({ ...printer, receiptWidth: value === '32' ? 32 : 48 })
            }
          />
          <SelectField
            label={t('printing.labels')}
            value={printer.labelLayout}
            options={(['sheet', 'roll'] as const).map((value) => ({
              value,
              label: t(`printing.labels.${value}`),
            }))}
            onValueChange={(value) =>
              setPrinter({ ...printer, labelLayout: value as 'sheet' | 'roll' })
            }
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={!valid} onClick={() => void test()}>
            <Printer aria-hidden="true" />
            {t('printing.test')}
          </Button>
          <Button disabled={!valid} onClick={() => void save()}>
            {t('settings.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PrintingSettingsPage() {
  const t = useT();
  return (
    <SettingsShell
      title={t('nav.settings.printing')}
      description={t('settings.printing.description')}
    >
      {(settings, update) => <PrintingForm settings={settings} update={update} />}
    </SettingsShell>
  );
}

function SecurityForm({ settings, update }: { settings: AllSettings; update: Update }) {
  const t = useT();
  const { security, fraud } = settings;
  const [idle, setIdle] = useState(String(security.idleLockMinutes));
  const [seller, setSeller] = useState(percentText(security.discountCaps.seller));
  const [manager, setManager] = useState(percentText(security.discountCaps.manager));
  const [adminFree, setAdminFree] = useState(security.discountCaps.admin === null);
  const [admin, setAdmin] = useState(percentText(security.discountCaps.admin ?? 10_000));
  const [doubleCheck, setDoubleCheck] = useState(security.inventoryDoubleCheck);
  const [discountAlert, setDiscountAlert] = useState(percentText(fraud.discountAlert));
  const [adjustments, setAdjustments] = useState(String(fraud.adjustmentsPerDay));
  const [cashDifference, setCashDifference] = useState(String(fraud.cashDifference));
  const [error, setError] = useState<string | null>(null);

  const saveSecurity = async () => {
    const values = {
      idleLockMinutes: intOrNull(idle, 1, 120),
      seller: parsePercent(seller),
      manager: parsePercent(manager),
      admin: adminFree ? null : parsePercent(admin),
    };
    if (
      values.idleLockMinutes === null ||
      values.seller === null ||
      values.manager === null ||
      (!adminFree && values.admin === null)
    ) {
      setError(t('security.invalidNumber'));
      return;
    }
    setError(null);
    const saved = await saveSection(
      () =>
        invoke('settings:saveSecurity', {
          idleLockMinutes: values.idleLockMinutes ?? 5,
          discountCaps: {
            seller: values.seller ?? 0,
            manager: values.manager ?? 0,
            admin: values.admin,
          },
          inventoryDoubleCheck: doubleCheck,
        }),
      t('settings.saved'),
    );
    if (saved !== null) update(saved);
  };
  const saveFraud = async () => {
    const alert = parsePercent(discountAlert);
    const perDay = intOrNull(adjustments, 1, 100);
    const difference = parseMoney(cashDifference);
    if (alert === null || alert < 100 || perDay === null || difference === null || difference < 0) {
      setError(t('security.invalidNumber'));
      return;
    }
    setError(null);
    const saved = await saveSection(
      () =>
        invoke('settings:saveFraud', {
          discountAlert: alert,
          adjustmentsPerDay: perDay,
          cashDifference: difference,
        }),
      t('settings.saved'),
    );
    if (saved !== null) update(saved);
  };
  return (
    <div className="flex flex-col gap-4">
      <FormError message={error} />
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <TextField
            label={t('security.idle')}
            inputMode="numeric"
            value={idle}
            onChange={(event) => setIdle(event.target.value)}
          />
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-2 text-base font-semibold">{t('security.caps')}</legend>
            <div className="grid gap-4 md:grid-cols-3">
              <TextField
                label={t('security.capSeller')}
                inputMode="decimal"
                value={seller}
                onChange={(event) => setSeller(event.target.value)}
              />
              <TextField
                label={t('security.capManager')}
                inputMode="decimal"
                value={manager}
                onChange={(event) => setManager(event.target.value)}
              />
              <TextField
                label={t('security.capAdmin')}
                inputMode="decimal"
                disabled={adminFree}
                value={admin}
                onChange={(event) => setAdmin(event.target.value)}
              />
            </div>
            <CheckboxField
              label={t('security.capAdminFree')}
              checked={adminFree}
              onChange={(event) => setAdminFree(event.target.checked)}
            />
          </fieldset>
          <CheckboxField
            label={t('security.doubleCheck')}
            checked={doubleCheck}
            onChange={(event) => setDoubleCheck(event.target.checked)}
          />
          <SaveBar onSave={() => void saveSecurity()} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('security.fraud')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t('security.fraudHint')}</p>
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label={t('security.discountAlert')}
              inputMode="decimal"
              value={discountAlert}
              onChange={(event) => setDiscountAlert(event.target.value)}
            />
            <TextField
              label={t('security.adjustments')}
              inputMode="numeric"
              value={adjustments}
              onChange={(event) => setAdjustments(event.target.value)}
            />
            <TextField
              label={t('security.cashDifference')}
              inputMode="numeric"
              value={cashDifference}
              onChange={(event) => setCashDifference(event.target.value)}
            />
          </div>
          <SaveBar onSave={() => void saveFraud()} />
        </CardContent>
      </Card>
    </div>
  );
}

export function SecuritySettingsPage() {
  const t = useT();
  return (
    <SettingsShell
      title={t('nav.settings.security')}
      description={t('settings.security.description')}
    >
      {(settings, update) => <SecurityForm settings={settings} update={update} />}
    </SettingsShell>
  );
}
