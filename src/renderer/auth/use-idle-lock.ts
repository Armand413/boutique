import { useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { useSession } from '../stores/session';

/** Une activité est signalée au processus principal au plus toutes les 20 s. */
const REPORT_INTERVAL_MS = 20_000;
/** Contrôle régulier : le processus principal fait foi (verrouillage même sans activité de l'interface). */
const POLL_INTERVAL_MS = 15_000;
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel'] as const;

/**
 * Verrouillage après inactivité (B.1) : l'interface signale l'activité clavier et souris,
 * verrouille dès le délai écoulé, et relit régulièrement l'état de la session.
 */
export function useIdleLock(idleLockSeconds: number): void {
  useEffect(() => {
    let lastActivity = Date.now();
    let lastReport = 0;
    let lockTimer: number | undefined;

    const lockNow = (): void => {
      void useSession
        .getState()
        .lock()
        .catch(() => useSession.getState().refresh());
    };
    const scheduleLock = (): void => {
      window.clearTimeout(lockTimer);
      lockTimer = window.setTimeout(lockNow, idleLockSeconds * 1000);
    };
    const onActivity = (): void => {
      lastActivity = Date.now();
      scheduleLock();
      if (lastActivity - lastReport >= REPORT_INTERVAL_MS) {
        lastReport = lastActivity;
        void invoke('session:activity').catch(() => undefined);
      }
    };

    scheduleLock();
    for (const name of ACTIVITY_EVENTS)
      window.addEventListener(name, onActivity, { passive: true });
    const poll = window.setInterval(() => void useSession.getState().refresh(), POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(lockTimer);
      window.clearInterval(poll);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
    };
  }, [idleLockSeconds]);
}
