import { safeStorage } from 'electron';
import type { KeyProtector } from '../db/keystore';

/**
 * Protection par le coffre du système (DPAPI sous Windows), liée au compte Windows.
 * API asynchrone d'Electron : les données chiffrées par l'ancienne API restent lisibles.
 */
export const safeStorageProtector: KeyProtector = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  protect: (plain) => safeStorage.encryptStringAsync(plain.toString('base64')),
  unprotect: async (sealed) => {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(sealed);
    return { plain: Buffer.from(result, 'base64'), stale: shouldReEncrypt };
  },
};
