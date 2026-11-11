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
  const clearError = useCallback(() => setError(null), []);
  return { error, clearError, run };
}
