import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * Adaptateur Zod pour React Hook Form, limité aux formulaires à plat (un niveau de champs).
 * La validation de référence reste celle du processus principal ; celle-ci guide la saisie.
 */
export function zodResolver<S extends z.ZodType<FieldValues>>(
  schema: S,
): Resolver<z.input<S> & FieldValues, unknown, z.output<S>> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const name = issue.path.map(String).join('.');
      errors[name] ??= { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: errors as FieldErrors<z.input<S> & FieldValues> };
  };
}
