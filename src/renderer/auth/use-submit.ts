import { useCallback, useState } from 'react';
import { errorMessage } from '../lib/ipc';

/**
 * Exécute une action de formulaire et conserve le message d'erreur du processus principal.
 * Renvoie true si l'action a réussi.
 */
export function useSubmit(): {
  error: string | null;
  clearError: () => void;
  run: (action: () => Promise<void>) => Promise<boolean>;
  /** Comme `run`, en renvoyant le résultat de l'action (null en cas d'échec). */
  submit: <T>(action: () => Promise<T>) => Promise<{ value: T } | null>;
} {
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    }
  }, []);
  const submit = useCallback(async <T>(action: () => Promise<T>) => {
    setError(null);
    try {
      return { value: await action() };
    } catch (failure) {
      setError(errorMessage(failure));
      return null;
    }
  }, []);
  const clearError = useCallback(() => setError(null), []);
  return { error, clearError, run, submit };
}
