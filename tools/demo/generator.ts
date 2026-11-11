/**
 * Générateur de données de démonstration et de charge (phase 9, E.7). Hors du code de production :
 * il n'est jamais empaqueté dans l'application. Toutes les écritures passent par les services
 * métier (règles, triggers, mouvements de stock, numérotation), regroupées en transactions par
 * lots pour aller vite (chaque appel de service devient un point de sauvegarde).
 */
import type { Session } from '../../src/main/auth/session';
import type { ProductService } from '../../src/main/catalog/product-service';
import type { ReferenceService } from '../../src/main/catalog/reference-service';
import type { Db } from '../../src/main/db/types';
import type { CashSessionService } from '../../src/main/sales/cash-session-service';
import type { CustomerService } from '../../src/main/sales/customer-service';
import type { SaleService } from '../../src/main/sales/sale-service';
import type { SupplierService } from '../../src/main/stock/supplier-service';
import type { CartLine, PaymentInput } from '../../src/shared/schemas/sales';

export interface GeneratorServices {
  db: Db;
  references: ReferenceService;
  products: ProductService;
  suppliers: SupplierService;
  customers: CustomerService;
  cashSessions: CashSessionService;
  sales: SaleService;
}

export interface Scale {
  brands: number;
  products: number;
  customers: number;
  suppliers: number;
  sales: number;
  /** Lignes d'entrée de marchandise ajoutées après les ventes (réassort). */
  restockLines: number;
}

export const DEMO_SCALE: Scale = {
  brands: 20,
  products: 2000,
  customers: 300,
  suppliers: 8,
  sales: 5000,
  restockLines: 2000,
};

export const LOAD_SCALE: Scale = {
  brands: 60,
  products: 50_000,
  customers: 5000,
  suppliers: 30,
  sales: 100_000,
  restockLines: 160_000,
};

export interface Actors {
  admin: Session;
  sellers: Session[];
}

export interface GeneratedSummary {
  brands: number;
  products: number;
  units: number;
  customers: number;
  sales: number;
  rejectedSales: number;
  firstRejection: string | null;
  movements: number;
  seconds: number;
}

/** Tirage pseudo-aléatoire reproductible (mulberry32). */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** IMEI de 15 chiffres valide (clé de Luhn), unique par numéro d'ordre. */
export function imei(sequence: number): string {
  const body = `35${String(sequence).padStart(12, '0')}`;
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    let digit = Number(body[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return `${body}${String((10 - (sum % 10)) % 10)}`;
}

const BRANDS = [
  'Samsung',
  'Tecno',
  'Infinix',
  'Itel',
  'Xiaomi',
  'Apple',
  'Nokia',
  'Oppo',
  'LG',
  'Hisense',
  'TCL',
  'Sony',
  'JBL',
  'Philips',
  'Binatone',
  'Nasco',
  'Roch',
  'Victron',
  'Jinko',
  'Felicity',
];

interface Kind {
  family: string;
  category: string;
  productType: 'phone' | 'accessory' | 'electronics' | 'appliance' | 'solar';
  tracking: 'none' | 'serial' | 'imei';
  names: string[];
  price: [number, number];
  warranty: number;
  /** Part du catalogue (sur 100). */
  share: number;
  attribute?: { code: string; label: string; unit: string; values: number[] };
}

const KINDS: Kind[] = [
  {
    family: 'Téléphonie',
    category: 'Smartphones',
    productType: 'phone',
    tracking: 'imei',
    names: ['Galaxy A', 'Spark', 'Hot', 'Redmi Note', 'Camon'],
    price: [60_000, 450_000],
    warranty: 12,
    share: 4,
    attribute: { code: 'stockage', label: 'Stockage', unit: 'Go', values: [64, 128, 256] },
  },
  {
    family: 'Téléphonie',
    category: 'Accessoires téléphone',
    productType: 'accessory',
    tracking: 'none',
    names: [
      'Coque',
      'Câble USB-C',
      'Chargeur rapide',
      'Écouteurs',
      'Verre trempé',
      'Batterie externe',
    ],
    price: [1500, 25_000],
    warranty: 0,
    share: 46,
  },
  {
    family: 'Électronique et audio',
    category: 'Téléviseurs',
    productType: 'electronics',
    tracking: 'serial',
    names: ['Smart TV', 'TV LED'],
    price: [90_000, 900_000],
    warranty: 24,
    share: 4,
    attribute: { code: 'pouces', label: 'Taille', unit: 'pouces', values: [32, 43, 50, 55, 65] },
  },
  {
    family: 'Électronique et audio',
    category: 'Audio',
    productType: 'electronics',
    tracking: 'none',
    names: ['Enceinte Bluetooth', 'Amplificateur', 'Barre de son', 'Micro'],
    price: [10_000, 350_000],
    warranty: 12,
    share: 12,
    attribute: {
      code: 'puissance_w',
      label: 'Puissance',
      unit: 'W',
      values: [20, 50, 100, 300, 1000],
    },
  },
  {
    family: 'Électroménager',
    category: 'Gros électroménager',
    productType: 'appliance',
    tracking: 'serial',
    names: ['Réfrigérateur', 'Congélateur', 'Climatiseur', 'Machine à laver'],
    price: [150_000, 700_000],
    warranty: 24,
    share: 4,
  },
  {
    family: 'Électroménager',
    category: 'Petit électroménager',
    productType: 'appliance',
    tracking: 'none',
    names: ['Ventilateur', 'Mixeur', 'Fer à repasser', 'Bouilloire'],
    price: [8000, 60_000],
    warranty: 6,
    share: 12,
  },
  {
    family: 'Énergie solaire',
    category: 'Panneaux',
    productType: 'solar',
    tracking: 'none',
    names: ['Panneau mono', 'Panneau poly'],
    price: [35_000, 180_000],
    warranty: 120,
    share: 6,
    attribute: {
      code: 'puissance_wc',
      label: 'Puissance crête',
      unit: 'Wc',
      values: [100, 200, 300, 450, 550],
    },
  },
  {
    family: 'Énergie solaire',
    category: 'Batteries',
    productType: 'solar',
    tracking: 'none',
    names: ['Batterie gel', 'Batterie lithium'],
    price: [60_000, 900_000],
    warranty: 24,
    share: 6,
    attribute: { code: 'capacite_ah', label: 'Capacité', unit: 'Ah', values: [100, 150, 200, 250] },
  },
  {
    family: 'Énergie solaire',
    category: 'Régulateurs et onduleurs',
    productType: 'solar',
    tracking: 'none',
    names: ['Régulateur MPPT', 'Régulateur PWM', 'Onduleur hybride'],
    price: [15_000, 750_000],
    warranty: 24,
    share: 6,
    attribute: { code: 'tension_v', label: 'Tension', unit: 'V', values: [12, 24, 48] },
  },
];

interface Variant {
  id: number;
  price: number;
  tracking: 'none' | 'serial' | 'imei';
}

const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)] as T;
const between = (rand: () => number, low: number, high: number) =>
  Math.round((low + rand() * (high - low)) / 100) * 100;

/** Exécute `count` actions par lots transactionnels, en rendant la main entre deux lots. */
async function batched(
  db: Db,
  count: number,
  size: number,
  action: (index: number) => void,
): Promise<void> {
  for (let start = 0; start < count; start += size) {
    db.transaction(() => {
      for (let index = start; index < Math.min(count, start + size); index += 1) action(index);
    })();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function setupReferences(services: GeneratorServices, admin: Session, scale: Scale) {
  const { db, references } = services;
  const familyId = (name: string) =>
    db
      .prepare<[string], number>('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL')
      .pluck()
      .get(name) ?? 0;
  const brands = Array.from({ length: scale.brands }, (_, index) => {
    const name =
      index < BRANDS.length
        ? (BRANDS[index] ?? `Marque ${String(index + 1)}`)
        : `Marque ${String(index + 1)}`;
    return references.saveBrand(admin, { name, isActive: true }).id;
  });
  const categories = KINDS.map((kind, index) => {
    const category = references.saveCategory(admin, {
      name: kind.category,
      parentId: familyId(kind.family),
      defaultTrackingMode: kind.tracking,
      defaultWarrantyMonths: kind.warranty,
      sortOrder: index,
      isActive: true,
    });
    const attribute =
      kind.attribute === undefined
        ? null
        : references.saveAttribute(admin, {
            categoryId: category.id,
            code: kind.attribute.code,
            label: kind.attribute.label,
            valueType: 'number',
            unit: kind.attribute.unit,
            choices: null,
            isRequired: false,
            isFilterable: true,
            sortOrder: 0,
            isActive: true,
          }).id;
    return { kind, categoryId: category.id, attribute };
  });
  return { brands, categories };
}

/**
 * Remplit une base vierge : marques, catégories et caractéristiques, produits des quatre familles,
 * clients, fournisseurs, réceptions (IMEI et numéros de série), ventes (comptant, crédit, remises,
 * kits, appareils suivis) et réassort. Renvoie un résumé chiffré.
 */
export async function generate(
  services: GeneratorServices,
  actors: Actors,
  scale: Scale,
  onProgress: (message: string) => void = () => undefined,
): Promise<GeneratedSummary> {
  const started = Date.now();
  const rand = random(20_261_111);
  const { db, products, suppliers, customers, cashSessions, sales } = services;
  const { admin, sellers } = actors;
  const { brands, categories } = setupReferences(services, admin, scale);
  const weighted = categories.flatMap((category) =>
    Array.from({ length: category.kind.share }, () => category),
  );

  const variants: Variant[] = [];
  onProgress('Produits…');
  await batched(db, scale.products, 500, (index) => {
    const { kind, categoryId, attribute } = pick(rand, weighted);
    const value = kind.attribute === undefined ? null : pick(rand, kind.attribute.values);
    const price = between(rand, kind.price[0], kind.price[1]);
    const name =
      `${pick(rand, kind.names)} ${value === null ? '' : `${String(value)} ${kind.attribute?.unit ?? ''} `}${String(index + 1)}`
        .replace(/\s+/g, ' ')
        .trim();
    const created = products.create(admin, {
      name,
      brandId: pick(rand, brands),
      categoryId,
      model: null,
      description: null,
      productType: kind.productType,
      trackingMode: kind.tracking,
      taxRateId: null,
      reorderLevel: kind.tracking === 'none' ? 3 : 1,
      warrantyMonths: kind.warranty,
      weightKg: null,
      attributes: attribute === null || value === null ? [] : [{ attributeId: attribute, value }],
      variants: [
        {
          sku: '',
          barcode: `20${String(index + 1).padStart(10, '0')}`,
          color: null,
          storageGb: null,
          ramGb: null,
          condition: 'new',
          salePrice: price,
          minSalePrice: Math.round((price * 0.8) / 100) * 100,
          isActive: true,
        },
      ],
    });
    const id = created.variants[0]?.id ?? 0;
    variants.push({ id, price, tracking: kind.tracking });
  });

  onProgress('Kits solaires…');
  const solar = variants
    .filter((_, index) => index % 50 === 7 && variants[index]?.tracking === 'none')
    .slice(0, 12);
  const kitFamily =
    categories.find((category) => category.kind.category === 'Panneaux')?.categoryId ?? 0;
  const kits: Variant[] = [];
  for (let index = 0; index + 1 < solar.length; index += 2) {
    const [first, second] = [solar[index], solar[index + 1]];
    if (first === undefined || second === undefined) continue;
    const price = Math.round(((first.price * 2 + second.price) * 0.95) / 100) * 100;
    const kit = products.create(admin, {
      name: `Kit solaire ${String(index / 2 + 1)}`,
      brandId: null,
      categoryId: kitFamily,
      model: null,
      description: null,
      productType: 'kit',
      trackingMode: 'none',
      taxRateId: null,
      reorderLevel: 0,
      warrantyMonths: 12,
      weightKg: null,
      attributes: [],
      variants: [
        {
          sku: '',
          barcode: null,
          color: null,
          storageGb: null,
          ramGb: null,
          condition: 'new',
          salePrice: price,
          minSalePrice: 0,
          isActive: true,
        },
      ],
    });
    const kitId = kit.variants[0]?.id ?? 0;
    products.setKitComponents(admin, kitId, [
      { variantId: first.id, quantity: 2 },
      { variantId: second.id, quantity: 1 },
    ]);
    kits.push({ id: kitId, price, tracking: 'none' });
  }

  onProgress('Fournisseurs et clients…');
  const supplierIds = Array.from(
    { length: scale.suppliers },
    (_, index) =>
      suppliers.save(admin, {
        name: `Fournisseur ${String(index + 1)}`,
        phone: `07 00 00 ${String(index).padStart(2, '0')} 00`,
        email: null,
        address: 'Abidjan',
        notes: null,
        isActive: true,
      }).id,
  );
  const customerIds: number[] = [];
  await batched(db, scale.customers, 500, (index) => {
    customerIds.push(
      customers.save(admin, {
        fullName: `Client ${String(index + 1)}`,
        phone: `05${String(index).padStart(8, '0')}`,
        address: null,
        notes: null,
        creditLimit: 2_000_000,
        isActive: true,
      }).id,
    );
  });

  onProgress('Réceptions…');
  const location =
    db.prepare<[], number>('SELECT id FROM stock_locations WHERE is_default = 1').pluck().get() ??
    0;
  const stock = new Map<number, number>();
  let serial = 1;
  const receiptBatches = Math.ceil(variants.length / 200);
  await batched(db, receiptBatches, 10, (batch) => {
    const slice = variants.slice(batch * 200, batch * 200 + 200);
    suppliers.receive(admin, {
      supplierId: pick(rand, supplierIds),
      locationId: location,
      receivedOn: '2026-01-05',
      notes: null,
      payment: null,
      lines: slice.map((variant) => {
        const quantity = variant.tracking === 'none' ? 20 : 4;
        stock.set(variant.id, quantity);
        return {
          variantId: variant.id,
          quantity,
          unitCost: Math.round((variant.price * 0.7) / 100) * 100,
          ...(variant.tracking === 'none'
            ? {}
            : {
                serials: Array.from({ length: quantity }, () => ({
                  serialNumber:
                    variant.tracking === 'imei'
                      ? imei(serial++)
                      : `SN${String(serial++).padStart(10, '0')}`,
                  imei2: null,
                })),
              }),
        };
      }),
    });
  });
  const units = new Map<number, number[]>();
  for (const row of db
    .prepare<[], { id: number; variant_id: number }>(
      "SELECT id, variant_id FROM serial_units WHERE status = 'in_stock'",
    )
    .all()) {
    const list = units.get(row.variant_id) ?? [];
    list.push(row.id);
    units.set(row.variant_id, list);
  }

  onProgress('Ventes…');
  const sellable = variants.filter((variant) => variant.tracking === 'none');
  const tracked = variants.filter((variant) => variant.tracking !== 'none');
  let soldCount = 0;
  const rejected: string[] = [];
  const salesPerSession = 400;
  await batched(db, scale.sales, 250, (index) => {
    if (index % salesPerSession === 0) {
      if (index > 0) {
        const current = cashSessions.current(admin);
        cashSessions.close(admin, current?.expectedCash ?? 0, null);
      }
      cashSessions.open(admin, 20_000);
    }
    const seller = pick(rand, sellers);
    const lines: CartLine[] = [];
    const lineCount = 1 + Math.floor(rand() * 4);
    for (let line = 0; line < lineCount; line += 1) {
      const variant = pick(rand, sellable);
      const quantity = 1 + Math.floor(rand() * 2);
      if (
        (stock.get(variant.id) ?? 0) < quantity ||
        lines.some((item) => item.variantId === variant.id)
      )
        continue;
      stock.set(variant.id, (stock.get(variant.id) ?? 0) - quantity);
      const discount = rand() < 0.05 ? { type: 'percent' as const, value: 500 } : null;
      lines.push({ variantId: variant.id, quantity, discount });
    }
    if (rand() < 0.08 && tracked.length > 0) {
      const variant = pick(rand, tracked);
      const available = units.get(variant.id) ?? [];
      const unit = available.pop();
      if (unit !== undefined) {
        lines.push({ variantId: variant.id, quantity: 1, discount: null, serialUnitIds: [unit] });
      }
    }
    if (rand() < 0.01 && kits.length > 0) {
      const kit = pick(rand, kits);
      lines.push({ variantId: kit.id, quantity: 1, discount: null });
    }
    if (lines.length === 0) return;
    const credit = rand() < 0.1;
    const preview = sales.preview(seller, lines, null, null);
    if (preview.issues.length > 0) return;
    const total = preview.total;
    const paid = credit ? Math.round(total * 0.3) : total;
    const payments: PaymentInput[] =
      paid > 0
        ? [{ method: rand() < 0.7 ? 'cash' : 'mobile_money', amount: paid, reference: null }]
        : [];
    try {
      sales.checkout(seller, {
        customerId: credit
          ? pick(rand, customerIds)
          : rand() < 0.2
            ? pick(rand, customerIds)
            : null,
        lines,
        globalDiscount: null,
        payments,
        installments: credit ? [{ dueDate: '2026-12-15', amount: total - paid }] : null,
        delivery: null,
      });
      soldCount += 1;
    } catch (error) {
      // Refus métier attendu (plafond de crédit d'un client atteint, par exemple) : compté et
      // signalé dans le résumé, la vente est simplement abandonnée.
      rejected.push(error instanceof Error ? error.message : String(error));
    }
  });
  const open = cashSessions.current(admin);
  if (open !== null) cashSessions.close(admin, open.expectedCash, null);

  onProgress('Réassort…');
  const prices = new Map(sellable.map((variant) => [variant.id, variant.price]));
  const restockBatches = Math.ceil(scale.restockLines / 500);
  await batched(db, restockBatches, 4, (batch) => {
    const count = Math.min(500, scale.restockLines - batch * 500);
    const chosen = new Set<number>();
    while (chosen.size < Math.min(count, sellable.length)) chosen.add(pick(rand, sellable).id);
    suppliers.receive(admin, {
      supplierId: pick(rand, supplierIds),
      locationId: location,
      receivedOn: '2026-06-01',
      notes: null,
      payment: null,
      lines: [...chosen].map((variantId) => ({
        variantId,
        quantity: 5,
        unitCost: Math.round(((prices.get(variantId) ?? 1000) * 0.7) / 100) * 100,
      })),
    });
  });

  const count = (sql: string) => db.prepare<[], number>(sql).pluck().get() ?? 0;
  return {
    brands: brands.length,
    products: count('SELECT count(*) FROM products'),
    units: count('SELECT count(*) FROM serial_units'),
    customers: customerIds.length,
    sales: soldCount,
    rejectedSales: rejected.length,
    firstRejection: rejected[0] ?? null,
    movements: count('SELECT count(*) FROM stock_movements'),
    seconds: Math.round((Date.now() - started) / 1000),
  };
}
