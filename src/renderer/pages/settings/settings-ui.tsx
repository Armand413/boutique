import { useEffect, useState, type ReactNode } from 'react';
import { ShieldX } from 'lucide-react';
import type { Permission } from '@shared/permissions';
import type { AllSettings } from '@shared/schemas/settings';
import { EmptyState, ErrorState, LoadingState } from '../../components/states/states';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { errorMessage, invoke } from '../../lib/ipc';
import { PageHeader } from '../../layout/AppShell';
import { useCan } from '../products/catalog-ui';

/** Pourcentage saisi (« 10 », « 12,5 ») en centièmes de pourcent ; null si invalide. */
export function parsePercent(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

export function percentText(basisPoints: number): string {
  return (basisPoints / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
}

export function intOrNull(text: string, min: number, max: number): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** Enregistre une section et affiche le résultat ; renvoie les paramètres à jour ou null. */
export async function saveSection(
  action: () => Promise<AllSettings>,
  success: string,
): Promise<AllSettings | null> {
  try {
    const saved = await action();
    toast.success(success);
    return saved;
  } catch (failure) {
    toast.error(errorMessage(failure));
    return null;
  }
}

/**
 * Cadre commun des sections de paramètres : chargement, erreur, droit manquant (le service le
 * refuserait aussi), puis contenu avec les paramètres courants.
 */
export function SettingsShell({
  title,
  description,
  permission = 'settings.manage',
  children,
}: {
  title: string;
  description: string;
  permission?: Permission;
  children: (settings: AllSettings, update: (next: AllSettings) => void) => ReactNode;
}) {
  const t = useT();
  const allowed = useCan(permission);
  const [settings, setSettings] = useState<AllSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    invoke('settings:get').then(
      (data) => {
        if (active) setSettings(data);
      },
      (failure: unknown) => {
        if (active) setError(errorMessage(failure));
      },
    );
    return () => {
      active = false;
    };
  }, [allowed, attempt]);
  const header = <PageHeader title={title} description={description} />;
  if (!allowed) {
    return (
      <>
        {header}
        <EmptyState
          icon={ShieldX}
          title={t('state.forbidden.title')}
          description={t('settings.forbidden')}
        />
      </>
    );
  }
  if (error !== null) {
    return (
      <>
        {header}
        <ErrorState
          title={t('settings.error')}
          message={error}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        />
      </>
    );
  }
  return (
    <>
      {header}
      {settings === null ? (
        <LoadingState label={t('state.loading')} rows={5} />
      ) : (
        children(settings, setSettings)
      )}
    </>
  );
}
