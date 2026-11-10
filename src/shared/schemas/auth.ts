import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PIN_MAX_LENGTH, USERNAME_PATTERN } from '../auth/policy';
import { PERMISSIONS, ROLES } from '../permissions';

/** Les règles de qualité (longueur, mots de passe courants) sont vérifiées par le service. */
const secret = z
  .string()
  .min(1)
  .max(PASSWORD_MAX_LENGTH * 4);
const pin = z.string().min(1).max(PIN_MAX_LENGTH);
export const usernameSchema = z.string().trim().regex(USERNAME_PATTERN);
const fullName = z.string().trim().min(1).max(100);
const id = z.number().int().positive();
/** Clé de récupération : 32 caractères utiles, tirets et espaces tolérés à la saisie. */
const recoveryKey = z.string().min(1).max(80);

export const roleSchema = z.enum(ROLES);
export const permissionSchema = z.enum(PERMISSIONS);

export const systemStatusSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('ready'),
    setupCompleted: z.boolean(),
    shopName: z.string(),
    auditChainBroken: z.boolean(),
  }),
  z.strictObject({ state: z.literal('locked') }),
  z.strictObject({
    state: z.literal('error'),
    code: z.enum(['KEY_UNAVAILABLE', 'INTEGRITY', 'MIGRATION', 'STARTUP']),
    message: z.string(),
  }),
]);
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export const setupInputSchema = z.strictObject({
  shopName: z.string().trim().min(1).max(120),
  username: usernameSchema,
  fullName,
  password: secret,
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export const recoveryKeyOutputSchema = z.strictObject({ recoveryKey: z.string() });

export const unlockDatabaseInputSchema = z.strictObject({ recoveryKey });

export const loginInputSchema = z.strictObject({ username: usernameSchema, password: secret });
export const pinLoginInputSchema = z.strictObject({ username: usernameSchema, pin });
export const unlockSessionInputSchema = z.strictObject({ secret });
export const changePasswordInputSchema = z.strictObject({
  currentPassword: secret,
  newPassword: secret,
});
export const setOwnPinInputSchema = z.strictObject({
  currentPassword: secret,
  pin: pin.nullable(),
});
export const recoveryResetInputSchema = z.strictObject({
  username: usernameSchema,
  recoveryKey,
  newPassword: secret,
});

export const sessionInfoSchema = z.strictObject({
  user: z.strictObject({
    id,
    username: z.string(),
    fullName: z.string(),
    role: roleSchema,
  }),
  method: z.enum(['password', 'pin']),
  permissions: z.array(permissionSchema),
  locked: z.boolean(),
  mustChangePassword: z.boolean(),
  idleLockSeconds: z.number().int().positive(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const userSummarySchema = z.strictObject({
  id,
  username: z.string(),
  fullName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  hasPin: z.boolean(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

export const createUserInputSchema = z.strictObject({
  username: usernameSchema,
  fullName,
  role: roleSchema,
  temporaryPassword: secret,
});
export const updateUserInputSchema = z.strictObject({
  id,
  fullName: fullName.optional(),
  role: roleSchema.optional(),
  isActive: z.boolean().optional(),
});
export const resetPasswordInputSchema = z.strictObject({ id, temporaryPassword: secret });
export const userIdInputSchema = z.strictObject({ id });

export const auditEntrySchema = z.strictObject({
  id,
  createdAt: z.string(),
  action: z.string(),
  username: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.number().int().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditListInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(200),
  beforeId: id.optional(),
});

export const auditVerificationSchema = z.strictObject({
  ok: z.boolean(),
  checked: z.number().int().nonnegative(),
  brokenAtId: z.number().int().nullable(),
});
export type AuditVerification = z.infer<typeof auditVerificationSchema>;
