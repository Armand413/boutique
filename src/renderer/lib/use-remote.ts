import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from './ipc';

export type RemoteState<T> =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/**
 * Chargement d'une donnée du processus principal avec états chargement, erreur et nouvel essai (A.6).
 * `loader` doit être stable (useCallback) : il est rappelé à chaque `reload`.
 */
export function useRemote<T>(loader: () => Promise<T>): {
  state: RemoteState<T>;
  reload: () => void;
} {
  const [state, setState] = useState<RemoteState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loader().then(
      (data) => {
        if (active) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [loader, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { state, reload };
}
