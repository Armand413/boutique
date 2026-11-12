import { useState } from 'react';
import type { AllSettings, ModuleName, ModulesSettings } from '@shared/schemas/settings';
import { Card, CardContent } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { CheckboxField } from '../../components/ui/form-field';
import { useT } from '../../i18n';
import { invoke } from '../../lib/ipc';
import { usePublicSettings } from '../../stores/public-settings';
import { saveSection, SettingsShell } from './settings-ui';

const ORDER: readonly ModuleName[] = ['suppliers', 'deliveries', 'warranty'];

function ModulesForm({
  settings,
  update,
}: {
  settings: AllSettings;
  update: (next: AllSettings) => void;
}) {
  const t = useT();
  const reloadPublic = usePublicSettings((state) => state.load);
  const [modules, setModules] = useState<ModulesSettings>(settings.modules);
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    setSaving(true);
    const saved = await saveSection(
      () => invoke('settings:saveModules', modules),
      t('settings.saved'),
    );
    setSaving(false);
    if (saved === null) return;
    update(saved);
    await reloadPublic();
  };
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 pt-6">
        <p className="text-muted-foreground text-sm">{t('modules.intro')}</p>
        {ORDER.map((module) => (
          <div key={module} className="flex flex-col gap-1">
            <CheckboxField
              label={t(`modules.${module}`)}
              checked={modules[module]}
              onChange={(event) => setModules({ ...modules, [module]: event.target.checked })}
            />
            <p className="text-muted-foreground pl-8 text-sm">{t(`modules.${module}.hint`)}</p>
          </div>
        ))}
        <div>
          <Button disabled={saving} onClick={() => void save()}>
            {t('settings.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Modules activables (D90) : fonctions masquées tant qu'elles sont désactivées, données conservées. */
export function ModulesPage() {
  const t = useT();
  return (
    <SettingsShell
      title={t('nav.settings.modules')}
      description={t('settings.modules.description')}
    >
      {(settings, update) => <ModulesForm settings={settings} update={update} />}
    </SettingsShell>
  );
}
