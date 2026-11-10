import { useId, useMemo, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { Permission } from '@shared/permissions';
import { MODULES, visibleModules } from '../app/modules';
import { breadcrumbOf, ROUTES, type RouteName } from '../app/routes';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/basic';
import { useT, type Translate } from '../i18n';
import { cn } from '../lib/cn';
import { useRouter } from '../stores/router';

const NO_PERMISSIONS: ReadonlySet<Permission> = new Set();

export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

interface Command {
  route: RouteName;
  label: string;
}

function buildCommands(t: Translate): Command[] {
  const allowedTopLevel = new Set(
    visibleModules(MODULES, NO_PERMISSIONS, import.meta.env.DEV).map((m) => m.route),
  );
  return (Object.keys(ROUTES) as RouteName[])
    .filter((route) => {
      const top = breadcrumbOf(route)[0];
      return top !== undefined && allowedTopLevel.has(top);
    })
    .map((route) => {
      const parent = ROUTES[route].parent;
      const label = t(ROUTES[route].labelKey);
      return { route, label: parent === null ? label : `${t(ROUTES[parent].labelKey)} › ${label}` };
    });
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Recherche globale Ctrl+K (A.3). Pour l'instant : navigation vers les écrans existants. */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const t = useT();
  const navigate = useRouter((state) => state.navigate);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const commands = useMemo(() => buildCommands(t), [t]);
  const results = useMemo(() => {
    const needle = normalizeSearch(query);
    return commands.filter((command) => normalizeSearch(command.label).includes(needle));
  }, [commands, query]);

  const close = (): void => {
    onOpenChange(false);
    setQuery('');
    setActiveIndex(0);
  };
  const choose = (command: Command | undefined): void => {
    if (command === undefined) return;
    navigate(command.route);
    close();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('common.close')} className="gap-3 p-4">
        <DialogTitle className="text-base">{t('search.title')}</DialogTitle>
        <DialogDescription>{t('search.description')}</DialogDescription>
        <Input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          aria-label={t('search.placeholder')}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label={t('search.results')}
          className="flex flex-col gap-1"
        >
          {results.length === 0 && (
            <li role="presentation" className="text-muted-foreground px-3 py-2 text-sm">
              {t('search.empty', { query })}
            </li>
          )}
          {results.map((command, index) => (
            <li
              key={command.route}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(command)}
              className={cn(
                'flex cursor-default items-center justify-between rounded-md px-3 py-2 text-sm',
                index === activeIndex && 'bg-muted',
              )}
            >
              {command.label}
              {index === activeIndex && (
                <CornerDownLeft className="text-muted-foreground size-4" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
