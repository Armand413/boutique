import { AppError } from '@shared/ipc/errors';

/**
 * Une seule exécution à la fois : un second appel pendant qu'une opération sensible est en cours
 * (installation, récupération) est refusé au lieu de s'entremêler avec la première.
 */
export class Exclusive {
  private running = false;

  constructor(private readonly busyMessage: string) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.running) throw new AppError('CONFLICT', this.busyMessage);
    this.running = true;
    try {
      return await operation();
    } finally {
      this.running = false;
    }
  }
}
