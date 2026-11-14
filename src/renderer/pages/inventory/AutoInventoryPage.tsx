import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { ReportRequest } from '@shared/schemas/reports';
import { Button } from '../../components/ui/button';
import { SelectField } from '../../components/ui/form-field';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';
import { ReportPanel } from '../reports/ReportsPage';
import { presetPeriod } from '../reports/report-format';

const PERIODS = ['today', 'week', 'month', 'lastMonth', 'year'] as const;
type Period = (typeof PERIODS)[number];

/**
 * Inventaire automatique (D95) : l'application connaît le stock de chaque article par les mouvements
 * qu'elle enregistre (entrées, ventes, sorties) et en tient l'inventaire sans comptage. Le contrôle
 * physique reste disponible pour corriger un vol ou une casse qui n'aurait pas été déclaré.
 */
export function AutoInventoryPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [period, setPeriod] = useState<Period>('month');
  const request: ReportRequest = { kind: 'inventory', period: presetPeriod(period) };
  return (
    <>
      <PageHeader
        title={t('autoInventory.title')}
        description={t('autoInventory.description')}
        actions={
          <Button variant="secondary" onClick={() => navigate('inventory.physical')}>
            <ClipboardCheck aria-hidden="true" />
            {t('autoInventory.physical')}
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <SelectField
          label={t('reports.preset')}
          value={period}
          options={PERIODS.map((value) => ({ value, label: t(`reports.preset.${value}`) }))}
          onValueChange={(value) => setPeriod(value as Period)}
        />
      </div>
      <p className="text-muted-foreground text-sm">{t('autoInventory.explanation')}</p>
      <ReportPanel key={JSON.stringify(request)} request={request} />
    </>
  );
}
