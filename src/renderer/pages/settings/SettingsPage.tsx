import { ChevronRight, Palette } from 'lucide-react';
import { Card } from '../../components/ui/basic';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { useRouter } from '../../stores/router';

/** Sommaire des paramètres ; chaque section s'ajoute ici lorsqu'elle est livrée. */
export function SettingsPage() {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  return (
    <>
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <Card>
        <button
          type="button"
          onClick={() => navigate('settings.appearance')}
          className="hover:bg-muted flex w-full items-center gap-4 rounded-lg p-6 text-left"
        >
          <Palette className="text-primary size-6" aria-hidden="true" />
          <span className="flex flex-1 flex-col gap-1">
            <span className="text-xl font-semibold">{t('settings.appearance.title')}</span>
            <span className="text-muted-foreground text-sm">
              {t('settings.appearance.description')}
            </span>
          </span>
          <ChevronRight className="text-muted-foreground size-5" aria-hidden="true" />
        </button>
      </Card>
    </>
  );
}
