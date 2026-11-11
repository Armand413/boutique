import type { IpcAccess } from '@shared/ipc/contract';
import { requireSession } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { AppRuntime } from '../system/runtime';
import type { Authorize } from './dispatch';

/** Contrôle d'accès des canaux : session de la base ouverte, verrouillage, permission. */
export function createAuthorizer(runtime: AppRuntime): Authorize {
  return (access: IpcAccess): Session | null => {
    if (access.kind === 'public') return null;
    const { sessions } = runtime.requireServices();
    const session = requireSession(sessions, {
      ...(access.permission === undefined ? {} : { permission: access.permission }),
      ...(access.allowLocked === true ? { allowLocked: true } : {}),
      ...(access.allowPasswordChange === true ? { allowPasswordChange: true } : {}),
    });
    if (access.touches !== false) sessions.touch();
    return session;
  };
}
