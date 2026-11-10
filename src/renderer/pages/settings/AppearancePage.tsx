import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  LANGUAGES,
  TEXT_SCALES,
  THEMES,
  languageSchema,
  textScaleSchema,
  type PreferencesPatch,
  type Theme,
} from '@shared/schemas/preferences';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Card, CardContent, CardHeader, CardTitle, Label } from '../../components/ui/basic';
import { Select } from '../../components/ui/radix';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/ipc';
import { usePreferences } from '../../stores/preferences';

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function AppearancePage() {
  const t = useT();
  const { status, error, preferences, load, update } = usePreferences();
  const themeGroupId = useId();
  const textScaleId = useId();
  const languageId = useId();

  const save = async (patch: PreferencesPatch): Promise<void> => {
    try {
      await update(patch);
      toast.success(t('appearance.saved'));
    } catch (saveError) {
      toast.error(errorMessage(saveError));
    }
  };

  const header = (
    <PageHeader
      title={t('settings.appearance.title')}
      description={t('settings.appearance.description')}
    />
  );
  if (status === 'loading') {
    return (
      <>
        {header}
        <LoadingState label={t('state.loading')} />
      </>
    );
  }
  if (status === 'error') {
    return (
      <>
        {header}
        <ErrorState
          title={t('state.preferences.error')}
          message={error ?? ''}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={() => void load()}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Card>
        <CardHeader>
          <CardTitle id={themeGroupId}>{t('appearance.theme')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-labelledby={themeGroupId} className="grid grid-cols-3 gap-4">
            {THEMES.map((theme: Theme) => {
              const Icon = THEME_ICONS[theme];
              const checked = preferences.theme === theme;
              return (
                <label
                  key={theme}
                  className={cn(
                    'has-[:focus-visible]:outline-ring flex cursor-pointer items-center gap-3 rounded-lg border-2 p-4 transition-colors has-[:focus-visible]:outline-2',
                    checked
                      ? 'border-primary bg-primary-soft text-primary-soft-foreground'
                      : 'border-border hover:bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={theme}
                    checked={checked}
                    onChange={() => void save({ theme })}
                    className="sr-only"
                  />
                  <Icon className="size-5" aria-hidden="true" />
                  <span className="text-base font-medium">{t(`appearance.theme.${theme}`)}</span>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="grid grid-cols-2 gap-6 pt-6">
          <div className="flex flex-col gap-2">
            <Label id={textScaleId}>{t('appearance.textScale')}</Label>
            <Select
              aria-labelledby={textScaleId}
              value={String(preferences.textScale)}
              options={TEXT_SCALES.map((scale) => ({
                value: String(scale),
                label: t(`appearance.textScale.${scale}`),
              }))}
              onValueChange={(value) =>
                void save({ textScale: textScaleSchema.parse(Number(value)) })
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label id={languageId}>{t('appearance.language')}</Label>
            <Select
              aria-labelledby={languageId}
              value={preferences.language}
              options={LANGUAGES.map((language) => ({
                value: language,
                label: t(`appearance.language.${language}`),
              }))}
              onValueChange={(value) => void save({ language: languageSchema.parse(value) })}
            />
          </div>
        </CardContent>
      </Card>
    </>
  );
}
