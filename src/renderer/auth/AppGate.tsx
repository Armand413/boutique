import { useEffect, type ReactNode } from 'react';
import type { SessionInfo } from '@shared/schemas/auth';
import { LoadingState } from '../components/states/states';
import { useT } from '../i18n';
import { useSession } from '../stores/session';
import { ForcedPasswordChangeScreen } from './ChangePasswordForm';
import { LockScreen } from './LockScreen';
import { LoginScreen } from './LoginScreen';
import { RecoveryKeyScreen } from './RecoveryKeyScreen';
import { SetupScreen } from './SetupScreen';
import { DatabaseLockedScreen, FatalScreen } from './SystemScreens';
import { useIdleLock } from './use-idle-lock';

function IdleLock({ session }: { session: SessionInfo }) {
  useIdleLock(session.idleLockSeconds);
  return null;
}

/**
 * Aiguillage du démarrage : base (erreur, verrouillée), installation, clé de récupération,
 * connexion, mot de passe à changer, verrouillage, puis application.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { loading, loadError, status, session, pendingRecoveryKey, refresh } = useSession();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-md p-8">
        <LoadingState label={t('startup.loading')} />
      </main>
    );
  }
  if (loadError !== null || status === null) return <FatalScreen message={loadError ?? ''} />;
  if (status.state === 'error') return <FatalScreen message={status.message} />;
  if (status.state === 'locked') return <DatabaseLockedScreen />;
  if (pendingRecoveryKey !== null) return <RecoveryKeyScreen recoveryKey={pendingRecoveryKey} />;
  if (!status.setupCompleted) return <SetupScreen />;
  if (session === null) return <LoginScreen />;
  if (session.locked) return <LockScreen session={session} />;
  if (session.mustChangePassword) return <ForcedPasswordChangeScreen />;
  return (
    <>
      <IdleLock session={session} />
      {children}
    </>
  );
}
