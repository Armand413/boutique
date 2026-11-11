import { parentPort, workerData } from 'node:worker_threads';
import { AppError } from '@shared/ipc/errors';
import { openDatabase } from '../db/connection';
import type { Db } from '../db/types';
import { executeTask, type ReportTask, type WorkerReply } from './report-tasks';

/**
 * Thread des rapports (5.1 : rapports lourds hors du processus qui sert l'interface et la caisse).
 * Il ouvre sa propre connexion à la base chiffrée, en lecture seule (ouverture SQLite en lecture
 * seule, plus `query_only`), avec la clé
 * reçue en mémoire, effacée aussitôt l'ouverture faite (D65). Aucune écriture n'est possible ici.
 */
interface WorkerInput {
  file: string;
  key: Uint8Array;
}

function open(input: WorkerInput): Db {
  const key = Buffer.from(input.key);
  try {
    const db = openDatabase(input.file, key, { readonly: true });
    db.pragma('query_only = ON');
    return db;
  } finally {
    key.fill(0);
    input.key.fill(0);
  }
}

function reply(message: WorkerReply): void {
  parentPort?.postMessage(message);
}

function start(): void {
  const port = parentPort;
  if (port === null) throw new Error('Le thread des rapports doit être lancé par l’application.');
  const db = open(workerData as WorkerInput);
  port.on('message', (message: { id: number; task: ReportTask } | 'close') => {
    if (message === 'close') {
      db.close();
      port.close();
      return;
    }
    try {
      reply({ id: message.id, ok: true, data: executeTask(db, message.task) });
    } catch (error) {
      reply(
        error instanceof AppError
          ? { id: message.id, ok: false, code: error.code, message: error.message }
          : {
              id: message.id,
              ok: false,
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : 'Erreur inconnue',
            },
      );
    }
  });
}

start();
