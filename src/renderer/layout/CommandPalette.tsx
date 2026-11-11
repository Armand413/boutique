import { useEffect, useId, useMemo, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { Permission } from '@shared/permissions';
import { MODULES, visibleModules } from '../app/modules';
import { breadcrumbOf, ROUTES, type RouteName } from '../app/routes';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/basic';
import { useT, type Translate } from '../i18n';
import { errorMessage, invoke } from '../lib/ipc';
import { toast } from '../components/ui/toast';
import { cn } from '../lib/cn';
import { useRouter } from '../stores/router';
import { useSession } from '../stores/session';

export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

interface Command {
  key: string;
  route: RouteName;
  params?: { productId: number };
  label: string;
  group: 'screens' | 'products' | 'devices';
}

interface RemoteResults {
  query: string;
  commands: Command[];
}

/** Produits (recherche plein texte) et appareils (IMEI ou numéro de série exact). */
async function searchCatalog(t: Translate, query: string): Promise<Command[]> {
  const [products, devices] = await Promise.all([
    invoke('products:search', { query, status: 'active', sort: 'name', offset: 0, limit: 6 }),
    query.replace(/\s/g, '').length >= 4
      ? invoke('serials:find', { serial: query })
      : Promise.resolve([]),
  ]);
  return [
    ...devices.map((device): Command => ({
      key: `device-${String(device.id)}`,
      route: 'products.detail',
      params: { productId: device.productId },
      group: 'devices',
      label: t('search.device', {
        serial: device.serialNumber,
        product: device.productName,
        status: t(`serial.${device.status}`),
      }),
    })),
    ...products.rows.map((row): Command => ({
      key: `variant-${String(row.variantId)}`,
      route: 'products.detail',
      params: { productId: row.productId },
      group: 'products',
      label: [row.name, row.variantLabel, row.sku].filter((part) => part !== '').join(' · '),
    })),
  ];
}

function buildCommands(t: Translate, granted: ReadonlySet<Permission>): Command[] {
  const allowedTopLevel = new Set(
    visibleModules(MODULES, granted, import.meta.env.DEV).map((m) => m.route),
  );
  return (Object.keys(ROUTES) as RouteName[])
    .filter((route) => {
      const top = breadcrumbOf(route)[0];
      // La fiche produit s'ouvre depuis un résultat de recherche, jamais seule.
      return top !== undefined && allowedTopLevel.has(top) && route !== 'products.detail';
    })
    .map((route) => {
      const parent = ROUTES[route].parent;
      const label = t(ROUTES[route].labelKey);
      return {
        key: route,
        route,
        group: 'screens' as const,
        label: parent === null ? label : `${t(ROUTES[parent].labelKey)} › ${label}`,
      };
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
  const permissions = useSession((state) => state.session?.permissions);
  const commands = useMemo(() => buildCommands(t, new Set(permissions ?? [])), [t, permissions]);
  const canSearchCatalog = (permissions ?? []).includes('product.view');
  const trimmed = query.trim();
  const [remote, setRemote] = useState<RemoteResults>({ query: '', commands: [] });
  useEffect(() => {
    if (!canSearchCatalog || trimmed.length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      searchCatalog(t, trimmed).then(
        (found) => {
          if (active) setRemote({ query: trimmed, commands: found });
        },
        (error: unknown) => {
          if (active) setRemote({ query: trimmed, commands: [] });
          toast.error(errorMessage(error));
        },
      );
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canSearchCatalog, trimmed, t]);
  const results = useMemo(() => {
    const needle = normalizeSearch(query);
    const screens = commands.filter((command) => normalizeSearch(command.label).includes(needle));
    const catalog = trimmed.length >= 2 && remote.query === trimmed ? remote.commands : [];
    return [...catalog, ...screens];
  }, [commands, query, trimmed, remote]);

  const close = (): void => {
    onOpenChange(false);
    setQuery('');
    setActiveIndex(0);
  };
  const choose = (command: Command | undefined): void => {
    if (command === undefined) return;
    navigate(command.route, command.params);
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
              key={command.key}
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
              <span className="flex min-w-0 flex-col">
                <span className="text-muted-foreground text-xs">
                  {t(`search.${command.group}`)}
                </span>
                <span className="truncate">{command.label}</span>
              </span>
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
