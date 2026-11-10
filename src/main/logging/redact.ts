/** Masquage des données sensibles avant écriture dans le journal technique (B.3). */
const SENSITIVE_KEY = /pass|pin|secret|token|key|hash|salt|cipher|credential|authorization/i;
const MAX_DEPTH = 5;

export const REDACTED = '[masqué]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[profondeur]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return output;
  }
  return value;
}
