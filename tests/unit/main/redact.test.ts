import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from '../../../src/main/logging/redact';

describe('masquage des journaux', () => {
  it('masque les clés sensibles à tous les niveaux', () => {
    const output = redact({
      user: 'awa',
      password: 'secret1',
      nested: { pinCode: '1234', dbKey: 'abc', list: [{ token: 't' }] },
    });
    expect(output).toEqual({
      user: 'awa',
      password: REDACTED,
      nested: { pinCode: REDACTED, dbKey: REDACTED, list: [{ token: REDACTED }] },
    });
  });

  it('réduit une erreur à son nom et à son message, sans la pile', () => {
    expect(redact(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
  });

  it('coupe les structures trop profondes', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redact(deep))).toContain('[profondeur]');
  });

  it('laisse passer les valeurs simples', () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBeNull();
  });
});
