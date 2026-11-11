import { useCallback, useState } from 'react';
import { KeyRound, MoreHorizontal, Pencil, UserPlus, XCircle } from 'lucide-react';
import { formatDateTime } from '@shared/format/date';
import type { UserSummary } from '@shared/schemas/auth';
import { ErrorState, LoadingState } from '../../components/states/states';
import { Badge, Card } from '../../components/ui/basic';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/radix';
import { toast } from '../../components/ui/toast';
import { useT } from '../../i18n';
import { PageHeader } from '../../layout/AppShell';
import { errorMessage, invoke } from '../../lib/ipc';
import { useRemote } from '../../lib/use-remote';
import { CreateUserDialog, EditUserDialog, ResetPasswordDialog } from './UserDialogs';

type Dialog =
  { kind: 'create' } | { kind: 'edit' | 'reset' | 'clearPin'; user: UserSummary } | null;

/** `loadedAt` : instant du chargement, pour savoir si un blocage est encore en cours. */
function StatusBadges({ user, loadedAt }: { user: UserSummary; loadedAt: number }) {
  const t = useT();
  const locked = user.lockedUntil !== null && Date.parse(user.lockedUntil) > loadedAt;
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={user.isActive ? 'success' : 'neutral'}>
        {t(user.isActive ? 'users.status.active' : 'users.status.inactive')}
      </Badge>
      {locked && <Badge tone="danger">{t('users.status.locked')}</Badge>}
      {user.mustChangePassword && <Badge tone="warning">{t('users.status.provisional')}</Badge>}
      {user.hasPin && <Badge tone="info">{t('users.status.pin')}</Badge>}
    </span>
  );
}

/** Gestion des comptes (4.9) : réservée à la permission user.manage, contrôlée aussi par le service. */
export function UsersPage() {
  const t = useT();
  const loader = useCallback(
    async () => ({ users: await invoke('users:list'), loadedAt: Date.now() }),
    [],
  );
  const { state, reload } = useRemote(loader);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (): void => setDialog(null);
  const done = (): void => {
    setDialog(null);
    reload();
  };

  const clearPin = async (user: UserSummary): Promise<void> => {
    try {
      await invoke('users:clearPin', { id: user.id });
      toast.success(t('users.pinCleared'));
      reload();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <Button onClick={() => setDialog({ kind: 'create' })}>
            <UserPlus aria-hidden="true" />
            {t('users.new')}
          </Button>
        }
      />
      {state.status === 'loading' && <LoadingState label={t('state.loading')} rows={4} />}
      {state.status === 'error' && (
        <ErrorState
          title={t('users.error')}
          message={state.message}
          solution={t('state.preferences.solution')}
          retryLabel={t('state.error.retry')}
          onRetry={reload}
        />
      )}
      {state.status === 'ready' && (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('users.col.name')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('users.col.username')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('users.col.role')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('users.col.status')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t('users.col.lastLogin')}
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">{t('users.col.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.data.users.map((user) => (
                <tr key={user.id} className="border-border border-t">
                  <td className="px-4 py-3 text-base font-medium">{user.fullName}</td>
                  <td className="px-4 py-3 font-mono">{user.username}</td>
                  <td className="px-4 py-3">{t(`role.${user.role}`)}</td>
                  <td className="px-4 py-3">
                    <StatusBadges user={user} loadedAt={state.data.loadedAt} />
                  </td>
                  <td className="tabular px-4 py-3">
                    {user.lastLoginAt === null
                      ? t('users.never')
                      : formatDateTime(user.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('users.actions', { name: user.fullName })}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', user })}>
                          <Pencil aria-hidden="true" />
                          {t('common.edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'reset', user })}>
                          <KeyRound aria-hidden="true" />
                          {t('users.resetPassword')}
                        </DropdownMenuItem>
                        {user.hasPin && (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'clearPin', user })}>
                            <XCircle aria-hidden="true" />
                            {t('users.clearPin')}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <CreateUserDialog
        open={dialog?.kind === 'create'}
        onOpenChange={(open) => !open && close()}
        onDone={done}
      />
      {dialog?.kind === 'edit' && (
        <EditUserDialog user={dialog.user} onOpenChange={close} onDone={done} />
      )}
      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog user={dialog.user} onOpenChange={close} onDone={done} />
      )}
      {dialog?.kind === 'clearPin' && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && close()}
          title={t('users.clearPin.title')}
          description={t('users.clearPin.confirm', { name: dialog.user.fullName })}
          confirmLabel={t('users.clearPin')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            const user = dialog.user;
            close();
            void clearPin(user);
          }}
        />
      )}
    </>
  );
}
