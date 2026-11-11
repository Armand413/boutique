import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AppError } from '@shared/ipc/errors';
import { logger } from '../logging/logger';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface ImageKind {
  extension: string;
  mime: string;
  matches: (bytes: Buffer) => boolean;
}

/** Formats acceptés, reconnus par leur signature (pas par l'extension du fichier). */
const KINDS: readonly ImageKind[] = [
  {
    extension: 'png',
    mime: 'image/png',
    matches: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: 'jpg',
    mime: 'image/jpeg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    extension: 'webp',
    mime: 'image/webp',
    matches: (b) =>
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
];

const STORED_NAME = /^(produit-\d+|logo)-[0-9a-f]{12}\.(png|jpg|webp)$/;

/** Photos des produits, copiées dans le dossier de données (jamais lues ailleurs). */
export class ImageStore {
  constructor(private readonly directory: string) {}

  /** Copie l'image choisie ; renvoie le nom enregistré dans products.image_path. */
  importImage(productId: number, sourcePath: string): string {
    return this.importAs(`produit-${String(productId)}`, sourcePath);
  }

  /** Logo de la boutique (paramètres, 4.11). */
  importLogo(sourcePath: string): string {
    return this.importAs('logo', sourcePath);
  }

  private importAs(prefix: string, sourcePath: string): string {
    const size = statSync(sourcePath).size;
    if (size > MAX_IMAGE_BYTES) {
      throw new AppError('VALIDATION_ERROR', 'Image trop lourde : 2 Mo au maximum.');
    }
    const bytes = readFileSync(sourcePath);
    const kind = KINDS.find((candidate) => candidate.matches(bytes));
    if (kind === undefined) {
      throw new AppError('VALIDATION_ERROR', 'Format d’image non reconnu : PNG, JPEG ou WebP.');
    }
    mkdirSync(this.directory, { recursive: true });
    const name = `${prefix}-${randomBytes(6).toString('hex')}.${kind.extension}`;
    writeFileSync(join(this.directory, name), bytes);
    return name;
  }

  dataUrl(name: string | null): string | null {
    if (name === null || !STORED_NAME.test(name)) return null;
    try {
      const bytes = readFileSync(join(this.directory, basename(name)));
      const kind = KINDS.find((candidate) => candidate.matches(bytes));
      return kind === undefined ? null : `data:${kind.mime};base64,${bytes.toString('base64')}`;
    } catch (error) {
      logger.warn('Photo de produit illisible', { name, error });
      return null;
    }
  }

  remove(name: string | null): void {
    if (name === null || !STORED_NAME.test(name)) return;
    rmSync(join(this.directory, basename(name)), { force: true });
  }
}
