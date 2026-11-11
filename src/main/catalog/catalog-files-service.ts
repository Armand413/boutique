import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AppError } from '@shared/ipc/errors';
import { activeCurrency } from '@shared/format/money';
import { categoryPath, variantLabel } from '@shared/catalog/tree';
import type { ImportAnalysis, LabelsInput } from '@shared/schemas/catalog';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import type { FileDialogs } from '../files/file-dialogs';
import {
  ATTRIBUTE_COLUMN_PREFIX,
  COLUMNS,
  CONDITION_WORDS,
  TRACKING_WORDS,
  TYPE_WORDS,
  parseCatalogRows,
  readRows,
  writeRows,
  type ParsedProduct,
} from './catalog-io';
import type { ImageStore } from './image-store';
import { renderLabels, type LabelData } from './labels';
import {
  findProduct,
  findVariant,
  serialUnitsOfVariant,
  setProductImage,
} from './product-repository';
import type { ProductService } from './product-service';
import { listAttributes, listBrands, listCategories, listTaxRates } from './reference-repository';

const IMPORT_TTL_MS = 15 * 60 * 1000;
const MAX_LABELS = 2000;

interface PendingImport {
  userId: number;
  products: ParsedProduct[];
  expiresAt: number;
}

export interface CatalogFilesDependencies {
  db: Db;
  products: ProductService;
  dialogs: FileDialogs;
  images: ImageStore;
  clock?: () => number;
}

/** Montant en unités de la devise (« 125000 », « 12.50 »), relu tel quel par l'import. */
function majorUnits(amount: number): string {
  const decimals = activeCurrency().decimals;
  return decimals === 0 ? String(amount) : (amount / 10 ** decimals).toFixed(decimals);
}

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Échanges de fichiers du catalogue : photo, import/export Excel-CSV, étiquettes (4.1). */
export class CatalogFilesService {
  private readonly pending = new Map<string, PendingImport>();
  private readonly db: Db;
  private readonly products: ProductService;
  private readonly dialogs: FileDialogs;
  private readonly images: ImageStore;
  private readonly now: () => number;

  constructor(dependencies: CatalogFilesDependencies) {
    this.db = dependencies.db;
    this.products = dependencies.products;
    this.dialogs = dependencies.dialogs;
    this.images = dependencies.images;
    this.now = dependencies.clock ?? Date.now;
  }

  async chooseImage(
    actor: Session,
    productId: number,
  ): Promise<{ hasImage: boolean; changed: boolean }> {
    requirePermission(actor, 'product.edit');
    const product = this.products.existingProduct(productId);
    const source = await this.dialogs.openFile({
      title: 'Photo du produit',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (source === null) return { hasImage: product.imagePath !== null, changed: false };
    const stored = this.images.importImage(productId, source);
    this.db.transaction(() => {
      setProductImage(this.db, productId, stored);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'product.image_changed',
        entityType: 'product',
        entityId: productId,
      });
    })();
    this.images.remove(product.imagePath);
    return { hasImage: true, changed: true };
  }

  clearImage(actor: Session, productId: number): { hasImage: boolean; changed: boolean } {
    requirePermission(actor, 'product.edit');
    const product = this.products.existingProduct(productId);
    if (product.imagePath === null) return { hasImage: false, changed: false };
    this.db.transaction(() => {
      setProductImage(this.db, productId, null);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'product.image_removed',
        entityType: 'product',
        entityId: productId,
      });
    })();
    this.images.remove(product.imagePath);
    return { hasImage: false, changed: true };
  }

  image(actor: Session, productId: number): { dataUrl: string | null } {
    requirePermission(actor, 'product.view');
    return { dataUrl: this.images.dataUrl(this.products.existingProduct(productId).imagePath) };
  }

  /** Export du catalogue actif ; le prix d'achat n'y figure qu'avec cost.view (B.2). */
  async exportCatalog(
    actor: Session,
    format: 'xlsx' | 'csv',
  ): Promise<{ saved: boolean; rows: number }> {
    requirePermission(actor, 'product.view');
    requirePermission(actor, 'export.run');
    const path = await this.dialogs.saveFile({
      title: 'Exporter le catalogue',
      defaultName: `catalogue-${today(this.now())}.${format}`,
      filters: [
        format === 'xlsx'
          ? { name: 'Classeur Excel', extensions: ['xlsx'] }
          : { name: 'CSV', extensions: ['csv'] },
      ],
    });
    if (path === null) return { saved: false, rows: 0 };
    const { header, rows } = this.catalogTable(actor.permissions.has('cost.view'));
    await writeRows(path, format, header, rows);
    appendAudit(this.db, {
      userId: actor.userId,
      action: 'catalog.exported',
      details: { format, rows: rows.length, withCost: actor.permissions.has('cost.view') },
    });
    return { saved: true, rows: rows.length };
  }

  /** Lit le fichier choisi et simule l'import ; rien n'est enregistré avant la confirmation. */
  async analyzeImport(actor: Session): Promise<ImportAnalysis> {
    requirePermission(actor, 'product.edit');
    requirePermission(actor, 'price.edit');
    const path = await this.dialogs.openFile({
      title: 'Importer des produits',
      filters: [{ name: 'Classeur Excel ou CSV', extensions: ['xlsx', 'csv'] }],
    });
    if (path === null)
      return { token: null, fileName: '', productCount: 0, variantCount: 0, errors: [] };
    const parsed = parseCatalogRows(await readRows(path), {
      categories: listCategories(this.db),
      brands: listBrands(this.db),
      taxRates: listTaxRates(this.db),
      attributes: listAttributes(this.db),
      canCreateBrands: actor.permissions.has('settings.manage'),
      canSetCost: actor.permissions.has('cost.view'),
    });
    const simulation = this.products.importProducts(actor, parsed.products, { dryRun: true });
    const errors = [...parsed.errors, ...simulation.errors].sort((a, b) => a.row - b.row);
    const fileName = basename(path);
    if (parsed.products.length === 0 && errors.length === 0) {
      errors.push({ row: 1, message: 'Le fichier ne contient aucun produit.' });
    }
    this.dropExpired();
    const token = errors.length === 0 ? randomBytes(16).toString('hex') : null;
    if (token !== null) {
      this.pending.set(token, {
        userId: actor.userId,
        products: parsed.products,
        expiresAt: this.now() + IMPORT_TTL_MS,
      });
    }
    return {
      token,
      fileName,
      productCount: parsed.products.length,
      variantCount: simulation.variants,
      errors,
    };
  }

  commitImport(actor: Session, token: string): { products: number; variants: number } {
    requirePermission(actor, 'product.edit');
    this.dropExpired();
    const pending = this.pending.get(token);
    if (pending?.userId !== actor.userId) {
      throw new AppError('NOT_FOUND', 'Cette analyse a expiré : choisissez à nouveau le fichier.');
    }
    this.pending.delete(token);
    const result = this.products.importProducts(actor, pending.products, { dryRun: false });
    if (result.errors.length > 0) {
      const [first] = result.errors;
      throw new AppError(
        'CONFLICT',
        `Import annulé, ligne ${String(first?.row ?? 0)} : ${first?.message ?? ''}`,
      );
    }
    return { products: result.products, variants: result.variants };
  }

  async labels(actor: Session, input: LabelsInput): Promise<{ saved: boolean }> {
    requirePermission(actor, 'product.view');
    const labels = this.labelData(input);
    const path = await this.dialogs.saveFile({
      title: 'Enregistrer les étiquettes',
      defaultName: `etiquettes-${today(this.now())}.pdf`,
      filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
    });
    if (path === null) return { saved: false };
    writeFileSync(path, await renderLabels(labels, input.layout));
    appendAudit(this.db, {
      userId: actor.userId,
      action: 'catalog.labels_generated',
      details: { labels: labels.length, layout: input.layout },
    });
    return { saved: true };
  }

  private labelData(input: LabelsInput): LabelData[] {
    const labels: LabelData[] = [];
    for (const item of input.items) {
      const variant = findVariant(this.db, item.variantId);
      const product = variant === null ? null : findProduct(this.db, variant.productId);
      if (variant === null || product === null)
        throw new AppError('NOT_FOUND', 'Article introuvable.');
      const base = {
        name: product.name,
        detail: [product.brandName, variantLabel(variant)]
          .filter((part) => part !== null && part !== '')
          .join(' · '),
        price: input.showPrice ? variant.salePrice : null,
      };
      if (item.serialUnitIds !== undefined) {
        const units = serialUnitsOfVariant(this.db, variant.id, item.serialUnitIds);
        if (units.length !== item.serialUnitIds.length)
          throw new AppError('NOT_FOUND', 'Unité introuvable pour cet article.');
        for (const unit of units) {
          for (let copy = 0; copy < item.copies; copy += 1) {
            labels.push({ ...base, code: unit.serialNumber, caption: variant.sku });
          }
        }
      } else {
        for (let copy = 0; copy < item.copies; copy += 1) {
          labels.push({ ...base, code: variant.barcode ?? variant.sku, caption: null });
        }
      }
      if (labels.length > MAX_LABELS) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Trop d’étiquettes : ${String(MAX_LABELS)} au maximum par document.`,
        );
      }
    }
    return labels;
  }

  private catalogTable(withCost: boolean): {
    header: string[];
    rows: (string | number | null)[][];
  } {
    const categories = listCategories(this.db);
    const taxes = new Map(listTaxRates(this.db).map((tax) => [tax.id, tax.name]));
    const definitions = new Map(
      listAttributes(this.db).map((attribute) => [attribute.id, attribute]),
    );
    const products = this.db
      .prepare<[], { id: number }>(
        'SELECT id FROM products WHERE is_active = 1 ORDER BY name COLLATE NOCASE, id',
      )
      .all();
    const values = this.db
      .prepare<
        [],
        {
          product_id: number;
          attribute_id: number;
          value_text: string | null;
          value_number: number | null;
        }
      >(
        `SELECT v.product_id, v.attribute_id, v.value_text, v.value_number FROM product_attribute_values v
         JOIN products p ON p.id = v.product_id WHERE p.is_active = 1`,
      )
      .all();
    const byProduct = new Map<number, Map<string, string>>();
    const codes = new Set<string>();
    for (const value of values) {
      const definition = definitions.get(value.attribute_id);
      if (definition === undefined) continue;
      const text =
        definition.valueType === 'boolean'
          ? value.value_number === 1
            ? 'Oui'
            : 'Non'
          : (value.value_text ?? String(value.value_number ?? ''));
      codes.add(definition.code);
      const map = byProduct.get(value.product_id) ?? new Map<string, string>();
      map.set(definition.code, text);
      byProduct.set(value.product_id, map);
    }
    const attributeCodes = [...codes].sort();
    const baseColumns = Object.entries(COLUMNS).filter(([key]) => withCost || key !== 'costPrice');
    const header = [
      ...baseColumns.map(([, title]) => title),
      ...attributeCodes.map((code) => `${ATTRIBUTE_COLUMN_PREFIX}${code}`),
    ];
    const rows: (string | number | null)[][] = [];
    for (const { id } of products) {
      const product = findProduct(this.db, id);
      if (product === null) continue;
      const variants = this.db
        .prepare<[number], { id: number }>(
          'SELECT id FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY id',
        )
        .all(id);
      for (const { id: variantId } of variants) {
        const variant = findVariant(this.db, variantId);
        if (variant === null) continue;
        const cells: Record<keyof typeof COLUMNS, string | number | null> = {
          name: product.name,
          brand: product.brandName,
          category: categoryPath(categories, product.categoryId).replaceAll(' › ', ' > '),
          type: TYPE_WORDS[product.productType],
          tracking: TRACKING_WORDS[product.trackingMode],
          model: product.model,
          description: product.description,
          tax: product.taxRateId === null ? null : (taxes.get(product.taxRateId) ?? null),
          reorderLevel: product.reorderLevel,
          warranty: product.warrantyMonths,
          weight: product.weightKg,
          sku: variant.sku,
          barcode: variant.barcode,
          color: variant.color,
          storage: variant.storageGb,
          ram: variant.ramGb,
          condition: CONDITION_WORDS[variant.condition],
          salePrice: majorUnits(variant.salePrice),
          minSalePrice: majorUnits(variant.minSalePrice),
          costPrice: majorUnits(variant.costPrice),
        };
        const attributes = byProduct.get(id);
        rows.push([
          ...baseColumns.map(([key]) => cells[key as keyof typeof COLUMNS]),
          ...attributeCodes.map((code) => attributes?.get(code) ?? null),
        ]);
      }
    }
    return { header, rows };
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [token, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(token);
    }
  }
}
