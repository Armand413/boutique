import { z } from 'zod';
import type { IpcChannel } from './channels';
import { preferencesPatchSchema, preferencesSchema } from '../schemas/preferences';

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  electron: z.string().min(1),
  chrome: z.string().min(1),
  node: z.string().min(1),
  isPackaged: z.boolean(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

const noInput = z.undefined();

/**
 * Contrat de chaque canal : schéma d'entrée et schéma de sortie.
 * Le processus principal valide les deux ; l'interface en déduit ses types.
 */
export const ipcContract = {
  'app:getInfo': { input: noInput, output: appInfoSchema },
  'preferences:get': { input: noInput, output: preferencesSchema },
  'preferences:set': { input: preferencesPatchSchema, output: preferencesSchema },
} as const satisfies Record<IpcChannel, { input: z.ZodType; output: z.ZodType }>;

export type IpcContract = typeof ipcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;
