import { z } from 'zod';
import {
  PASSWORD_MIN_LENGTH,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  USERNAME_PATTERN,
} from '@shared/auth/policy';
import { ROLES } from '@shared/permissions';
import type { Translate } from '../i18n';

/**
 * Schémas de saisie de l'interface, avec messages traduits. Ils guident l'utilisateur ;
 * les règles de référence (mots de passe courants, blocage...) sont appliquées par le service.
 */
export function formSchemas(t: Translate) {
  const required = z.string().trim().min(1, t('form.required'));
  const username = z.string().trim().regex(USERNAME_PATTERN, t('form.username'));
  const password = z.string().min(PASSWORD_MIN_LENGTH, t('form.passwordLength'));
  const secret = z.string().min(1, t('form.required'));
  const pinPattern = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);
  const pin = z.string().regex(pinPattern, t('form.pin'));
  const recoveryKey = z
    .string()
    .refine((value) => value.replace(/[\s-]/g, '').length === 32, t('form.recoveryKey'));
  const confirmed = <S extends z.ZodObject<{ password: z.ZodString; confirmation: z.ZodString }>>(
    schema: S,
  ) =>
    schema.refine((values) => values.password === values.confirmation, {
      message: t('form.passwordMismatch'),
      path: ['confirmation'],
    });

  return {
    setup: confirmed(
      z.object({
        shopName: required,
        fullName: required,
        username,
        password,
        confirmation: z.string(),
      }),
    ),
    login: z.object({ username, password: secret }),
    pinLogin: z.object({ username, pin }),
    unlock: z.object({ secret }),
    recoveryKey: z.object({ recoveryKey }),
    recoverAdmin: confirmed(
      z.object({ username, recoveryKey, password, confirmation: z.string() }),
    ),
    changePassword: confirmed(
      z.object({ currentPassword: secret, password, confirmation: z.string() }),
    ),
    ownPin: z.object({ pin, currentPassword: secret }),
    createUser: z.object({
      fullName: required,
      username,
      role: z.enum(ROLES),
      temporaryPassword: password,
    }),
    editUser: z.object({ fullName: required, role: z.enum(ROLES), isActive: z.boolean() }),
    resetPassword: z.object({ temporaryPassword: password }),
  };
}
