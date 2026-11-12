import { beforeEach, describe, expect, it } from 'vitest';
import { cartLines, usePos } from '../../../src/renderer/stores/pos';

const CABLE = {
  variantId: 7,
  name: 'Câble USB-C',
  variantLabel: '',
  sku: 'ACC-CABLE',
  productType: 'accessory' as const,
  trackingMode: 'none' as const,
};

function onlyLine() {
  const [line] = usePos.getState().lines;
  if (line === undefined) throw new Error('panier vide');
  return line;
}

describe('prix convenu à la caisse (D92)', () => {
  beforeEach(() => usePos.getState().clear());

  it('envoie la différence avec le prix affiché, recalculée selon la quantité', () => {
    usePos.getState().add(CABLE);
    usePos.getState().setAgreedPrice(onlyLine().key, { price: 2000, listPrice: 2500 });
    expect(cartLines(usePos.getState().lines)[0]?.discount).toEqual({ type: 'amount', value: 500 });
    usePos.getState().setQuantity(onlyLine().key, 3);
    expect(cartLines(usePos.getState().lines)[0]?.discount).toEqual({
      type: 'amount',
      value: 1500,
    });
  });

  it('annule la négociation pour un prix vide ou supérieur ou égal au prix affiché', () => {
    usePos.getState().add(CABLE);
    const { key } = onlyLine();
    usePos.getState().setAgreedPrice(key, { price: 2000, listPrice: 2500 });
    usePos.getState().setAgreedPrice(key, { price: 2500, listPrice: 2500 });
    expect(onlyLine().agreedPrice).toBeUndefined();
    expect(cartLines(usePos.getState().lines)[0]?.discount).toBeNull();
    usePos.getState().setAgreedPrice(key, { price: 1800, listPrice: 2500 });
    usePos.getState().setAgreedPrice(key, null);
    expect(cartLines(usePos.getState().lines)[0]?.discount).toBeNull();
  });

  it('attend le prix affiché quand le prix convenu est saisi avant le recalcul du panier', () => {
    usePos.getState().add(CABLE);
    const { key } = onlyLine();
    usePos.getState().setAgreedPrice(key, { price: 2000, listPrice: null });
    expect(cartLines(usePos.getState().lines)[0]?.discount).toBeNull();
    usePos.getState().setAgreedPrice(key, { price: 2000, listPrice: 2500 });
    expect(cartLines(usePos.getState().lines)[0]?.discount).toEqual({ type: 'amount', value: 500 });
  });
});
