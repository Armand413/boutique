import type { ReactNode } from 'react';
import { Store } from 'lucide-react';
import { Card, CardContent } from '../components/ui/basic';
import { useT } from '../i18n';
import { useSession } from '../stores/session';

interface AuthLayoutProps {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}

/** Écran plein, centré, pour le démarrage, la connexion et le verrouillage. */
export function AuthLayout({ title, description, children, wide = false }: AuthLayoutProps) {
  const t = useT();
  const shopName = useSession((state) =>
    state.status?.state === 'ready' && state.status.shopName !== '' ? state.status.shopName : null,
  );
  return (
    <main className="bg-background flex min-h-full items-center justify-center overflow-y-auto p-8">
      <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-md'}>
        <div className="mb-6 flex items-center justify-center gap-3">
          <Store className="text-primary size-8" aria-hidden="true" />
          <span className="text-xl font-semibold">{shopName ?? t('app.name')}</span>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-6 p-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold">{title}</h1>
              {description !== undefined && (
                <p className="text-muted-foreground text-base">{description}</p>
              )}
            </div>
            {children}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
