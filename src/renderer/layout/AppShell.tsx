import { useState, type ReactNode } from 'react';
import { useHotkey } from '../hotkeys/hotkeys';
import { useT } from '../i18n';
import { CommandPalette } from './CommandPalette';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

const MAIN_ID = 'contenu-principal';

/** Structure fixe (A.3) : barre latérale, en-tête avec fil d'Ariane et recherche, contenu. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const [searchOpen, setSearchOpen] = useState(false);
  useHotkey('Ctrl+K', () => setSearchOpen(true));

  return (
    <div className="flex h-full">
      <a
        href={`#${MAIN_ID}`}
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:px-4 focus:py-2"
      >
        {t('app.skipToContent')}
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenSearch={() => setSearchOpen(true)} />
        <main id={MAIN_ID} tabIndex={-1} className="flex-1 overflow-y-auto p-8 outline-none">
          <div className="mx-auto flex max-w-5xl flex-col gap-6">{children}</div>
        </main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="text-muted-foreground text-base">{description}</p>
      </div>
      {actions}
    </div>
  );
}
