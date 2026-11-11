import { app } from 'electron';
import { AppError } from '@shared/ipc/errors';
import type { Session } from '../../auth/session';
import type { PreferencesService } from '../../services/preferences-service';
import type { AppRuntime } from '../../system/runtime';
import type { IpcContext, IpcHandlers } from '../dispatch';

export interface HandlerDependencies {
  preferences: PreferencesService;
  runtime: AppRuntime;
}

/** Session garantie par le contrôle d'accès du canal (jamais null pour un canal « session »). */
function actor(context: IpcContext): Session {
  if (context.session === null)
    throw new AppError('UNAUTHENTICATED', 'Connectez-vous pour continuer.');
  return context.session;
}

export function createHandlers({ preferences, runtime }: HandlerDependencies): IpcHandlers {
  const services = () => runtime.requireServices();
  return {
    'app:getInfo': () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      isPackaged: app.isPackaged,
    }),
    'preferences:get': () => preferences.get(),
    'preferences:set': (patch) => preferences.update(patch),

    'system:getStatus': () => runtime.getStatus(),
    'system:unlockDatabase': ({ recoveryKey }) => runtime.unlockDatabase(recoveryKey),
    'setup:complete': async (input) => ({ recoveryKey: await services().setup.complete(input) }),

    'auth:login': ({ username, password }) => services().auth.login(username, password),
    'auth:loginPin': ({ username, pin }) => services().auth.loginWithPin(username, pin),
    'auth:logout': () => {
      services().auth.logout();
      return null;
    },
    'auth:recoverAdmin': async ({ username, recoveryKey, newPassword }) => ({
      recoveryKey: await services().auth.recoverAdmin(username, recoveryKey, newPassword),
    }),
    'auth:changePassword': ({ currentPassword, newPassword }) =>
      services().auth.changePassword(currentPassword, newPassword),
    'auth:setOwnPin': async ({ currentPassword, pin }) => {
      await services().auth.setOwnPin(currentPassword, pin);
      return null;
    },

    'session:get': () =>
      runtime.getStatus().state === 'ready' ? services().auth.sessionInfo() : null,
    'session:activity': () => null,
    'session:lock': () => services().auth.lock(),
    'session:unlock': ({ secret }) => services().auth.unlock(secret),

    'users:list': (_input, context) => services().users.list(actor(context)),
    'users:create': (input, context) => services().users.create(actor(context), input),
    'users:update': ({ id, ...changes }, context) =>
      services().users.update(actor(context), id, {
        ...(changes.fullName === undefined ? {} : { fullName: changes.fullName }),
        ...(changes.role === undefined ? {} : { role: changes.role }),
        ...(changes.isActive === undefined ? {} : { isActive: changes.isActive }),
      }),
    'users:resetPassword': ({ id, temporaryPassword }, context) =>
      services().users.resetPassword(actor(context), id, temporaryPassword),
    'users:clearPin': ({ id }, context) => services().users.clearPin(actor(context), id),

    'audit:list': ({ limit, beforeId }, context) =>
      services().audit.list(actor(context), limit, beforeId),
    'audit:verify': (_input, context) => services().audit.verify(actor(context)),
  };
}
