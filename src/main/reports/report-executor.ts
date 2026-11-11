import { Worker } from 'node:worker_threads';
import { AppError, IPC_ERROR_CODES, type IpcErrorCode } from '@shared/ipc/errors';
import type { Db } from '../db/types';
import { logger } from '../logging/logger';
import { executeTask, type ReportTask, type TaskResult, type WorkerReply } from './report-tasks';

/** Exécute un calcul de rapport : dans un thread en production, dans le processus en test. */
export interface ReportExecutor {
  execute<T extends ReportTask>(task: T): Promise<TaskResult<T>>;
  close(): Promise<void>;
}

const FAILURE =
  'Le calcul du rapport a échoué. Réessayez ; si le problème persiste, redémarrez l’application.';

function toAppError(code: string, message: string): AppError {
  const known = (IPC_ERROR_CODES as readonly string[]).includes(code);
  if (!known || code === 'INTERNAL_ERROR') {
    logger.error('Calcul de rapport en échec', { message });
    return new AppError('INTERNAL_ERROR', FAILURE);
  }
  return new AppError(code as IpcErrorCode, message);
}

/** Exécution directe sur une connexion (tests unitaires, aucun thread). */
export class InlineExecutor implements ReportExecutor {
  constructor(private readonly db: Db) {}

  execute<T extends ReportTask>(task: T): Promise<TaskResult<T>> {
    return Promise.resolve(executeTask(this.db, task) as TaskResult<T>);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Thread des rapports, démarré au premier besoin et relancé s'il s'arrête. La clé n'est copiée
 * qu'en mémoire, vers le thread (D65) ; elle n'est jamais écrite ni journalisée.
 */
export class WorkerExecutor implements ReportExecutor {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly script: string,
    private readonly file: string,
    private readonly key: Buffer,
  ) {}

  execute<T extends ReportTask>(task: T): Promise<TaskResult<T>> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<TaskResult<T>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, task });
    });
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker === null) return;
    worker.postMessage('close');
    await worker.terminate();
  }

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker;
    const worker = new Worker(this.script, {
      workerData: { file: this.file, key: new Uint8Array(this.key) },
    });
    worker.on('message', (reply: WorkerReply) => this.settle(reply));
    worker.on('error', (error: Error) => this.failAll(worker, error));
    worker.on('exit', (code) => {
      if (code !== 0)
        this.failAll(worker, new Error(`Thread des rapports arrêté (code ${String(code)}).`));
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private settle(reply: WorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (pending === undefined) return;
    this.pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.data);
    else pending.reject(toAppError(reply.code, reply.message));
  }

  private failAll(worker: Worker, error: Error): void {
    if (this.worker === worker) this.worker = null;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(toAppError('INTERNAL_ERROR', error.message));
    }
  }
}
