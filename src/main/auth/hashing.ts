import { hash, hashRaw, verify, type Options } from '@node-rs/argon2';

/**
 * Paramètres Argon2id (algorithme par défaut de la bibliothèque ; la base n'accepte que des
 * empreintes « $argon2id$ ») : 64 Mio, 3 passes, au-dessus du minimum OWASP de 19 Mio / 2 passes,
 * environ 0,1 s sur un poste modeste. Le sel unique est généré par la bibliothèque.
 */
export const ARGON2_OPTIONS: Readonly<Options> = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

/** Compare un secret à son empreinte ; une empreinte illisible vaut un échec, jamais une exception. */
export async function verifySecret(storedHash: string, secret: string): Promise<boolean> {
  try {
    return await verify(storedHash, secret);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Vérification factice pour un identifiant inconnu : même durée qu'une vraie vérification,
 * pour ne pas révéler l'existence d'un compte.
 */
export async function verifyAgainstDummy(secret: string): Promise<false> {
  dummyHash ??= hashSecret('compte-inexistant-valeur-de-reference');
  await verifySecret(await dummyHash, secret);
  return false;
}

export interface KdfParameters {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Dérive une clé de 256 bits d'un secret et d'un sel (séquestre de la clé de la base) ;
 * les paramètres enregistrés avec le séquestre priment sur les valeurs courantes.
 */
export function deriveKey(
  secret: string,
  salt: Buffer,
  parameters?: KdfParameters,
): Promise<Buffer> {
  return hashRaw(secret, { ...ARGON2_OPTIONS, ...parameters, salt, outputLen: 32 });
}
