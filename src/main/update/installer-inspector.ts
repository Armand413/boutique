import { execFile } from 'node:child_process';
import { z } from 'zod';
import type { InstallerSignature } from '@shared/schemas/update';

/** Ce que Windows dit d'un exécutable : signature Authenticode et informations de version. */
export interface ExecutableInfo {
  signature: InstallerSignature;
  /** Sujet du certificat du signataire, si la signature est valide. */
  signer: string | null;
  thumbprint: string | null;
  productName: string;
  productVersion: string;
}

export interface ExecutableInspector {
  inspect(path: string): Promise<ExecutableInfo>;
}

/**
 * Le chemin passe par une variable d'environnement, jamais dans le texte du script : aucune
 * injection possible par un nom de fichier.
 */
const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$p = $env:BOUTIQUE_INSPECT_PATH',
  '$s = Get-AuthenticodeSignature -LiteralPath $p',
  '$v = (Get-Item -LiteralPath $p).VersionInfo',
  '[pscustomobject]@{ status = [string]$s.Status; subject = $s.SignerCertificate.Subject;',
  '  thumbprint = $s.SignerCertificate.Thumbprint; productName = $v.ProductName;',
  '  productVersion = $v.ProductVersion } | ConvertTo-Json -Compress',
].join('\n');

const outputSchema = z.object({
  status: z.string(),
  subject: z.string().nullable(),
  thumbprint: z.string().nullable(),
  productName: z.string().nullable(),
  productVersion: z.string().nullable(),
});

function signatureOf(status: string): InstallerSignature {
  if (status === 'Valid') return 'valid';
  if (status === 'NotSigned') return 'unsigned';
  return 'invalid';
}

/** Interroge Windows par PowerShell (`Get-AuthenticodeSignature`), sans réseau. */
export const windowsExecutableInspector: ExecutableInspector = {
  inspect(path) {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
        {
          env: { ...process.env, BOUTIQUE_INSPECT_PATH: path },
          timeout: 60_000,
          windowsHide: true,
        },
        (error, stdout) => {
          if (error !== null) {
            reject(new Error(`Vérification de l'installateur impossible : ${error.message}`));
            return;
          }
          try {
            const output = outputSchema.parse(JSON.parse(stdout.trim()));
            const signature = signatureOf(output.status);
            resolve({
              signature,
              signer: signature === 'valid' ? output.subject : null,
              thumbprint: signature === 'valid' ? output.thumbprint : null,
              productName: output.productName ?? '',
              productVersion: output.productVersion ?? '',
            });
          } catch (parseError) {
            reject(parseError instanceof Error ? parseError : new Error(String(parseError)));
          }
        },
      );
    });
  },
};
