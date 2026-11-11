import type { CartLine, CartLineDisplay } from '@shared/schemas/sales';
import { lineKey, type PosLine } from '../../stores/pos';

let audio: AudioContext | null = null;

/** Signal sonore discret au scan (A.5) : aigu si l'article est trouvé, grave sinon. */
export function beep(success: boolean): void {
  try {
    audio ??= new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = success ? 1200 : 300;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + (success ? 0.06 : 0.18));
  } catch {
    // Pas de sortie audio sur ce poste : le retour visuel suffit.
  }
}

/** Lignes de caisse reconstruites depuis un panier repris (attente ou devis). */
export function posLinesFrom(
  lines: readonly CartLine[],
  display: readonly CartLineDisplay[],
): PosLine[] {
  return lines.map((line, index) => {
    const info = display[index];
    const componentQuantities: Record<number, number> = {};
    const components = (info?.components ?? []).map((component) => {
      componentQuantities[component.variantId] = component.quantity;
      return {
        variantId: component.variantId,
        name: component.name,
        required: component.quantity * line.quantity,
        serialUnitIds:
          line.components?.find((chosen) => chosen.variantId === component.variantId)
            ?.serialUnitIds ?? [],
        serialNumbers: component.serialNumbers,
      };
    });
    return {
      key: lineKey(),
      variantId: line.variantId,
      name: info?.name ?? '',
      variantLabel: info?.variantLabel ?? '',
      sku: info?.sku ?? '',
      productType: info?.productType ?? 'accessory',
      trackingMode: info?.trackingMode ?? 'none',
      quantity: line.quantity,
      discount: line.discount,
      serialUnitIds: line.serialUnitIds ?? [],
      serialNumbers: info?.serialNumbers ?? [],
      components,
      componentQuantities,
      ...(line.quoteLineId === undefined ? {} : { quoteLineId: line.quoteLineId }),
    };
  });
}

/** La ligne demande-t-elle encore des numéros (article suivi ou composants suivis d'un kit) ? */
export function missingUnits(line: PosLine): boolean {
  const trackedItem =
    line.trackingMode !== 'none' && line.productType !== 'kit' && line.productType !== 'service';
  if (trackedItem && line.serialUnitIds.length !== line.quantity) return true;
  return line.components.some((component) => component.serialUnitIds.length !== component.required);
}
