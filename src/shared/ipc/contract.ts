import { z } from 'zod';
import type { IpcChannel } from './channels';
import type { Permission } from '../permissions';
import { preferencesPatchSchema, preferencesSchema } from '../schemas/preferences';
import {
  auditEntrySchema,
  auditListInputSchema,
  auditVerificationSchema,
  changePasswordInputSchema,
  createUserInputSchema,
  loginInputSchema,
  pinLoginInputSchema,
  recoveryKeyOutputSchema,
  recoveryResetInputSchema,
  resetPasswordInputSchema,
  sessionInfoSchema,
  setOwnPinInputSchema,
  setupInputSchema,
  systemStatusSchema,
  unlockDatabaseInputSchema,
  unlockSessionInputSchema,
  updateUserInputSchema,
  userIdInputSchema,
  userSummarySchema,
} from '../schemas/auth';

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  electron: z.string().min(1),
  chrome: z.string().min(1),
  node: z.string().min(1),
  isPackaged: z.boolean(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/**
 * Accès exigé par un canal, contrôlé par le processus principal avant l'appel du service.
 * - public : sans session (démarrage, connexion) ;
 * - session : session ouverte et déverrouillée, éventuellement avec une permission.
 */
export type IpcAccess =
  | { kind: 'public' }
  | {
      kind: 'session';
      permission?: Permission;
      allowLocked?: true;
      allowPasswordChange?: true;
      /** Compte comme une activité de l'utilisateur (par défaut : oui). */
      touches?: false;
    };

const PUBLIC: IpcAccess = { kind: 'public' };
const SESSION: IpcAccess = { kind: 'session' };
const needs = (permission: Permission): IpcAccess => ({ kind: 'session', permission });

const noInput = z.undefined();
const nothing = z.null();

/**
 * Contrat de chaque canal : schémas d'entrée et de sortie, et accès requis.
 * Le processus principal valide tout ; l'interface en déduit ses types.
 */
export const ipcContract = {
  'app:getInfo': { input: noInput, output: appInfoSchema, access: PUBLIC },
  'preferences:get': { input: noInput, output: preferencesSchema, access: PUBLIC },
  'preferences:set': { input: preferencesPatchSchema, output: preferencesSchema, access: PUBLIC },
  'system:getStatus': { input: noInput, output: systemStatusSchema, access: PUBLIC },
  'system:unlockDatabase': {
    input: unlockDatabaseInputSchema,
    output: systemStatusSchema,
    access: PUBLIC,
  },
  'setup:complete': { input: setupInputSchema, output: recoveryKeyOutputSchema, access: PUBLIC },
  'auth:login': { input: loginInputSchema, output: sessionInfoSchema, access: PUBLIC },
  'auth:loginPin': { input: pinLoginInputSchema, output: sessionInfoSchema, access: PUBLIC },
  'auth:logout': { input: noInput, output: nothing, access: PUBLIC },
  'auth:recoverAdmin': {
    input: recoveryResetInputSchema,
    output: recoveryKeyOutputSchema,
    access: PUBLIC,
  },
  'auth:changePassword': {
    input: changePasswordInputSchema,
    output: sessionInfoSchema,
    access: { kind: 'session', allowPasswordChange: true },
  },
  'auth:setOwnPin': { input: setOwnPinInputSchema, output: nothing, access: SESSION },
  'session:get': { input: noInput, output: sessionInfoSchema.nullable(), access: PUBLIC },
  'session:activity': { input: noInput, output: nothing, access: SESSION },
  'session:lock': {
    input: noInput,
    output: sessionInfoSchema,
    access: { kind: 'session', allowPasswordChange: true, touches: false },
  },
  'session:unlock': {
    input: unlockSessionInputSchema,
    output: sessionInfoSchema,
    access: { kind: 'session', allowLocked: true, touches: false },
  },
  'users:list': {
    input: noInput,
    output: z.array(userSummarySchema),
    access: needs('user.manage'),
  },
  'users:create': {
    input: createUserInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'users:update': {
    input: updateUserInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'users:resetPassword': {
    input: resetPasswordInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'users:clearPin': {
    input: userIdInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'audit:list': {
    input: auditListInputSchema,
    output: z.array(auditEntrySchema),
    access: needs('audit.view'),
  },
  'audit:verify': { input: noInput, output: auditVerificationSchema, access: needs('audit.view') },
} as const satisfies Record<IpcChannel, { input: z.ZodType; output: z.ZodType; access: IpcAccess }>;

export type IpcContract = typeof ipcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;
