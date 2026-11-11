import { z } from 'zod';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ImageStore } from '../catalog/image-store';
import type { Db } from '../db/types';
import { getSetting } from '../settings/settings-repository';
import { plain } from './pdf';

/** Identité de la boutique sur les documents (4.11) : nom, coordonnées, logo, mentions légales. */
export interface ShopIdentity {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  legal?: string | null;
  /** Logo en `data:` (seule forme d'image acceptée par la génération PDF). */
  logo?: string | null;
}

const text = z.string().nullable();

export function readShopIdentity(db: Db, images: ImageStore | null): ShopIdentity {
  const name = getSetting(db, 'shop.name', z.string());
  return {
    name: name === '' ? 'Boutique' : name,
    address: getSetting(db, 'shop.address', text),
    phone: getSetting(db, 'shop.phone', text),
    email: getSetting(db, 'shop.email', text),
    legal: getSetting(db, 'shop.legal', text),
    logo: images === null ? null : images.dataUrl(getSetting(db, 'shop.logo', text)),
  };
}

/** Coordonnées sous le nom (ticket et documents A4). */
export function contactLines(shop: ShopIdentity): string[] {
  const contact = [shop.phone, shop.email].filter(
    (part): part is string => typeof part === 'string',
  );
  return [
    ...(typeof shop.address === 'string' ? shop.address.split('\n') : []),
    ...(contact.length === 0 ? [] : [contact.join(' · ')]),
  ];
}

/** Bloc d'en-tête gauche des documents A4 : logo, nom et coordonnées. */
export function shopBlock(shop: ShopIdentity): Content {
  return {
    stack: [
      ...(typeof shop.logo === 'string'
        ? [
            {
              image: shop.logo,
              fit: [140, 48] as [number, number],
              margin: [0, 0, 0, 4] as [number, number, number, number],
            },
          ]
        : []),
      { text: shop.name, style: 'shop' },
      ...contactLines(shop).map((line) => ({ text: plain(line), fontSize: 9 })),
    ],
  };
}

/** Mentions légales en pied de chaque page des documents A4. */
export function withLegalFooter(
  document: TDocumentDefinitions,
  shop: ShopIdentity,
): TDocumentDefinitions {
  if (typeof shop.legal !== 'string') return document;
  const legal = plain(shop.legal);
  return {
    ...document,
    footer: { text: legal, fontSize: 8, alignment: 'center', margin: [40, 8, 40, 0] },
  };
}
