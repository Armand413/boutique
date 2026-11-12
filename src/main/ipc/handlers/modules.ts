import type { IpcChannel } from '@shared/ipc/channels';
import { AppError } from '@shared/ipc/errors';
import type { ModuleName, ModulesSettings } from '@shared/schemas/settings';
import type { IpcHandler } from '../dispatch';

const MODULE_LABELS: Readonly<Record<ModuleName, string>> = {
  suppliers: 'Fournisseurs',
  deliveries: 'Livraisons',
  warranty: 'Garantie et SAV',
};

/** Erreur claire quand une opération touche un module désactivé. */
export function requireModule(modules: ModulesSettings, module: ModuleName): void {
  if (!modules[module]) {
    throw new AppError(
      'FORBIDDEN',
      `Le module « ${MODULE_LABELS[module]} » est désactivé (Paramètres › Modules).`,
    );
  }
}

/**
 * Gestionnaire d'un canal propre à un module activable (D90) : refusé tant que le module est
 * désactivé ; les modules sont relus à chaque appel.
 */
export function withModule<C extends IpcChannel>(
  modules: () => ModulesSettings,
  module: ModuleName,
  handler: IpcHandler<C>,
): IpcHandler<C> {
  return (input, context) => {
    requireModule(modules(), module);
    return handler(input, context);
  };
}
