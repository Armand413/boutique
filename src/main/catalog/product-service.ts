import { AppError } from '@shared/ipc/errors';
import { allowedTrackingModes, isStockedType, SERIAL_STATUSES } from '@shared/catalog/constants';
import {
  categoryPath,
  descendantIds,
  effectiveAttributes,
  variantLabel,
} from '@shared/catalog/tree';
import {
  SERIAL_UNITS_SHOWN,
  type CreateProductInput,
  type ImportIssue,
  type ProductDetail,
  type ProductSearchInput,
  type ProductSearchOutput,
  type SaveVariantInput,
  type SerialLookup,
  type UpdateProductInput,
  type VariantInput,
} from '@shared/schemas/catalog';
import { normalizeSerial } from '@shared/catalog/imei';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import { readValue, resolveAttributeValues } from './attribute-values';
import {
  barcodeOwner,
  findProduct,
  findSerials,
  findVariant,
  generateSku,
  insertProduct,
  insertVariant,
  isTypeLocked,
  listKitComponents,
  listVariants,
  productSerialUnits,
  readAttributeValues,
  replaceAttributeValues,
  replaceKitComponents,
  setProductActive,
  skuExists,
  stockByLocation,
  updateProduct,
  updateVariant,
  type ProductFields,
  type ProductRecord,
  type VariantFields,
  type VariantRecord,
} from './product-repository';
import { searchProducts } from './product-search';
import {
  insertBrand,
  listAttributes,
  listBrands,
  listCategories,
  listTaxRates,
} from './reference-repository';
import { toAppError } from '../db/errors';
import type { ParsedProduct } from './catalog-io';

type ProductInput = Omit<CreateProductInput, 'variants'>;

/** Produits, variantes, caractéristiques et kits (4.1, 4.2, 4.12). */
export class ProductService {
  constructor(private readonly db: Db) {}

  search(actor: Session, input: ProductSearchInput): ProductSearchOutput {
    requirePermission(actor, 'product.view');
    const categoryIds =
      input.categoryId === undefined
        ? null
        : descendantIds(listCategories(this.db), input.categoryId);
    return searchProducts(this.db, input, categoryIds, actor.permissions.has('cost.view'));
  }

  detail(actor: Session, productId: number): ProductDetail {
    requirePermission(actor, 'product.view');
    const product = this.existingProduct(productId);
    const categories = listCategories(this.db);
    const definitions = new Map(
      listAttributes(this.db).map((attribute) => [attribute.id, attribute]),
    );
    const withCost = actor.permissions.has('cost.view');
    const family = categories.find((category) => category.id === product.categoryId)?.familyId;
    return {
      id: product.id,
      name: product.name,
      brandId: product.brandId,
      brandName: product.brandName,
      categoryId: product.categoryId,
      categoryPath: categoryPath(categories, product.categoryId),
      familyId: family ?? product.categoryId,
      model: product.model,
      description: product.description,
      productType: product.productType,
      trackingMode: product.trackingMode,
      isStocked: product.isStocked,
      taxRateId: product.taxRateId,
      reorderLevel: product.reorderLevel,
      warrantyMonths: product.warrantyMonths,
      weightKg: product.weightKg,
      hasImage: product.imagePath !== null,
      isActive: product.isActive,
      typeLocked: isTypeLocked(this.db, product.id),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
      attributes: readAttributeValues(this.db, product.id).flatMap((stored) => {
        const definition = definitions.get(stored.attributeId);
        return definition === undefined
          ? []
          : [{ attributeId: stored.attributeId, value: readValue(definition, stored) }];
      }),
      variants: listVariants(this.db, product.id).map((variant) => {
        const stock = stockByLocation(this.db, variant.id);
        return {
          id: variant.id,
          sku: variant.sku,
          barcode: variant.barcode,
          color: variant.color,
          storageGb: variant.storageGb,
          ramGb: variant.ramGb,
          condition: variant.condition,
          label: variantLabel(variant),
          costPrice: withCost ? variant.costPrice : null,
          avgCost: withCost ? variant.avgCost : null,
          salePrice: variant.salePrice,
          minSalePrice: variant.minSalePrice,
          isActive: variant.isActive,
          stock,
          stockTotal: stock.reduce((sum, level) => sum + level.quantity, 0),
          components: product.productType === 'kit' ? listKitComponents(this.db, variant.id) : [],
        };
      }),
      serialUnits:
        product.trackingMode === 'none'
          ? {
              counts: Object.fromEntries(SERIAL_STATUSES.map((status) => [status, 0])) as Record<
                (typeof SERIAL_STATUSES)[number],
                number
              >,
              items: [],
            }
          : productSerialUnits(this.db, product.id, SERIAL_UNITS_SHOWN),
    };
  }

  create(actor: Session, input: CreateProductInput): ProductDetail {
    requirePermission(actor, 'product.edit');
    requirePermission(actor, 'price.edit');
    const fields = this.checkedFields(input, null);
    const values = this.checkedAttributes(input);
    this.assertVariantsDistinct(input.variants);
    const productId = this.db.transaction(() => {
      const id = insertProduct(this.db, fields, actor.userId);
      replaceAttributeValues(this.db, id, values);
      const skus = input.variants.map((variant) => this.addVariant(actor, id, variant));
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'product.created',
        entityType: 'product',
        entityId: id,
        details: { name: fields.name, type: fields.productType, skus },
      });
      return id;
    })();
    return this.detail(actor, productId);
  }

  update(actor: Session, input: UpdateProductInput): ProductDetail {
    requirePermission(actor, 'product.edit');
    const current = this.existingProduct(input.id);
    const fields = this.checkedFields(input, current);
    const values = this.checkedAttributes(input);
    this.db.transaction(() => {
      updateProduct(this.db, current.id, fields);
      replaceAttributeValues(this.db, current.id, values);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'product.updated',
        entityType: 'product',
        entityId: current.id,
        details: changedFields(current, fields),
      });
    })();
    return this.detail(actor, current.id);
  }

  setActive(actor: Session, productId: number, isActive: boolean): ProductDetail {
    requirePermission(actor, 'product.edit');
    const product = this.existingProduct(productId);
    if (product.isActive !== isActive) {
      this.db.transaction(() => {
        setProductActive(this.db, productId, isActive);
        appendAudit(this.db, {
          userId: actor.userId,
          action: isActive ? 'product.restored' : 'product.archived',
          entityType: 'product',
          entityId: productId,
          details: { name: product.name },
        });
      })();
    }
    return this.detail(actor, productId);
  }

  saveVariant(actor: Session, input: SaveVariantInput): ProductDetail {
    requirePermission(actor, 'product.edit');
    const product = this.existingProduct(input.productId);
    const { productId, id, ...variant } = input;
    this.db.transaction(() => {
      if (id === undefined) {
        requirePermission(actor, 'price.edit');
        this.assertVariantsDistinct([...listVariants(this.db, productId), variant]);
        const sku = this.addVariant(actor, productId, variant);
        appendAudit(this.db, {
          userId: actor.userId,
          action: 'variant.created',
          entityType: 'product',
          entityId: product.id,
          details: { sku },
        });
        return;
      }
      const current = this.existingVariant(id, productId);
      this.assertVariantsDistinct([
        ...listVariants(this.db, productId).filter((other) => other.id !== id),
        variant,
      ]);
      const priceChanged =
        variant.salePrice !== current.salePrice || variant.minSalePrice !== current.minSalePrice;
      if (priceChanged) requirePermission(actor, 'price.edit');
      const fields = this.variantFields(actor, productId, variant, current);
      updateVariant(this.db, id, fields);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'variant.updated',
        entityType: 'product',
        entityId: product.id,
        details: { variantId: id, ...changedFields(current, fields) },
      });
    })();
    return this.detail(actor, productId);
  }

  setKitComponents(
    actor: Session,
    kitVariantId: number,
    components: readonly { variantId: number; quantity: number }[],
  ): ProductDetail {
    requirePermission(actor, 'product.edit');
    const kit = findVariant(this.db, kitVariantId);
    const kitProduct = kit === null ? null : findProduct(this.db, kit.productId);
    if (kit === null || kitProduct === null) throw new AppError('NOT_FOUND', 'Kit introuvable.');
    if (kitProduct.productType !== 'kit') {
      throw new AppError('VALIDATION_ERROR', 'Seul un produit de type kit a une composition.');
    }
    const ids = components.map((component) => component.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new AppError('VALIDATION_ERROR', 'Un composant figure deux fois dans le kit.');
    }
    for (const component of components) {
      const variant = findVariant(this.db, component.variantId);
      const product = variant === null ? null : findProduct(this.db, variant.productId);
      if (variant === null || product === null)
        throw new AppError('NOT_FOUND', 'Composant introuvable.');
      if (product.productType === 'kit') {
        throw new AppError('VALIDATION_ERROR', 'Un kit ne peut pas contenir un autre kit.');
      }
    }
    this.db.transaction(() => {
      replaceKitComponents(this.db, kitVariantId, components, actor.userId);
      appendAudit(this.db, {
        userId: actor.userId,
        action: 'kit.components_set',
        entityType: 'product',
        entityId: kitProduct.id,
        details: { kitVariantId, components: components.map((c) => [c.variantId, c.quantity]) },
      });
    })();
    return this.detail(actor, kitProduct.id);
  }

  /** Recherche d'un appareil par IMEI ou numéro de série (4.2) ; la vente n'est visible qu'avec sale.view. */
  findSerial(actor: Session, serial: string): SerialLookup[] {
    requirePermission(actor, 'product.view');
    const withSale = actor.permissions.has('sale.view');
    return findSerials(this.db, normalizeSerial(serial)).map((row) => ({
      id: row.id,
      serialNumber: row.serial_number,
      imei2: row.imei2,
      status: row.status,
      productId: row.product_id,
      productName: row.product_name,
      variantLabel: variantLabel({
        color: row.color,
        storageGb: row.storage_gb,
        ramGb: row.ram_gb,
        condition: row.condition,
      }),
      sku: row.sku,
      receivedAt: row.received_at,
      soldAt: row.sold_at,
      warrantyEnd: row.warranty_end,
      invoiceNumber: withSale ? row.invoice_number : null,
      customerName: withSale ? row.customer_name : null,
    }));
  }

  /**
   * Création en masse depuis un fichier (4.1), tout ou rien. Chaque produit est contrôlé comme une
   * saisie manuelle ; les erreurs sont rattachées à leur ligne. `dryRun` annule tout à la fin
   * (analyse avant confirmation).
   */
  importProducts(
    actor: Session,
    products: readonly ParsedProduct[],
    options: { dryRun: boolean },
  ): { products: number; variants: number; errors: ImportIssue[] } {
    requirePermission(actor, 'product.edit');
    requirePermission(actor, 'price.edit');
    const errors: ImportIssue[] = [];
    let variants = 0;
    const createdBrands = new Map<string, number>();
    try {
      this.db.transaction(() => {
        for (const product of products) {
          try {
            this.db.transaction(() => {
              const brandId = this.importBrand(actor, product.newBrandName, createdBrands);
              const input = { ...product.input, brandId: brandId ?? product.input.brandId };
              const fields = this.checkedFields(input, null);
              const values = this.checkedAttributes(input);
              this.assertVariantsDistinct(input.variants);
              const id = insertProduct(this.db, fields, actor.userId);
              replaceAttributeValues(this.db, id, values);
              for (const variant of input.variants) this.addVariant(actor, id, variant);
            })();
            variants += product.input.variants.length;
          } catch (error) {
            const appError = error instanceof AppError ? error : toAppError(error);
            if (appError === null) throw error;
            errors.push({ row: product.row, message: appError.message });
          }
        }
        if (options.dryRun || errors.length > 0) throw new RollbackSignal();
        appendAudit(this.db, {
          userId: actor.userId,
          action: 'catalog.imported',
          details: { products: products.length, variants, brands: [...createdBrands.keys()] },
        });
      })();
    } catch (error) {
      if (!(error instanceof RollbackSignal)) throw error;
    }
    return { products: products.length, variants, errors };
  }

  private importBrand(
    actor: Session,
    name: string | null,
    created: Map<string, number>,
  ): number | null {
    if (name === null) return null;
    const key = name.toLowerCase();
    const known = created.get(key);
    if (known !== undefined) return known;
    requirePermission(actor, 'settings.manage');
    const id = insertBrand(this.db, { name, isActive: true }, actor.userId);
    created.set(key, id);
    return id;
  }

  existingProduct(id: number): ProductRecord {
    const product = findProduct(this.db, id);
    if (product === null) throw new AppError('NOT_FOUND', 'Produit introuvable.');
    return product;
  }

  /** Ajoute une variante dans la transaction en cours ; renvoie sa référence. */
  addVariant(actor: Session, productId: number, variant: VariantInput): string {
    const fields = this.variantFields(actor, productId, variant, null);
    insertVariant(this.db, productId, fields, actor.userId);
    return fields.sku;
  }

  private variantFields(
    actor: Session,
    productId: number,
    variant: VariantInput,
    current: VariantRecord | null,
  ): VariantFields {
    if (variant.costPrice !== undefined) requirePermission(actor, 'cost.view');
    const sku =
      variant.sku === '' ? (current?.sku ?? generateSku(this.db, productId)) : variant.sku;
    if (sku.toLowerCase() !== current?.sku.toLowerCase() && skuExists(this.db, sku)) {
      throw new AppError('CONFLICT', `La référence « ${sku} » est déjà utilisée.`);
    }
    if (variant.barcode !== null) {
      const owner = barcodeOwner(this.db, variant.barcode);
      if (owner !== null && owner !== current?.id) {
        throw new AppError('CONFLICT', `Le code-barres « ${variant.barcode} » est déjà utilisé.`);
      }
    }
    return {
      sku,
      barcode: variant.barcode,
      color: variant.color,
      storageGb: variant.storageGb,
      ramGb: variant.ramGb,
      condition: variant.condition,
      costPrice: variant.costPrice ?? current?.costPrice ?? 0,
      salePrice: variant.salePrice,
      minSalePrice: variant.minSalePrice,
      isActive: variant.isActive,
    };
  }

  private assertVariantsDistinct(
    variants: readonly Pick<VariantInput, 'color' | 'storageGb' | 'ramGb' | 'condition'>[],
  ): void {
    const keys = variants.map((variant) =>
      [
        variant.color?.toLowerCase() ?? '',
        variant.storageGb ?? 0,
        variant.ramGb ?? 0,
        variant.condition,
      ].join('|'),
    );
    if (new Set(keys).size !== keys.length) {
      throw new AppError(
        'CONFLICT',
        'Deux variantes ont la même couleur, la même mémoire et le même état.',
      );
    }
  }

  private checkedFields(input: ProductInput, current: ProductRecord | null): ProductFields {
    const category = listCategories(this.db).find((candidate) => candidate.id === input.categoryId);
    if (category === undefined) throw new AppError('NOT_FOUND', 'Catégorie introuvable.');
    if (!category.isActive && category.id !== current?.categoryId) {
      throw new AppError('VALIDATION_ERROR', 'Cette catégorie est archivée.');
    }
    if (input.brandId !== null) {
      const brand = listBrands(this.db).find((candidate) => candidate.id === input.brandId);
      if (brand === undefined) throw new AppError('NOT_FOUND', 'Marque introuvable.');
      if (!brand.isActive && brand.id !== current?.brandId) {
        throw new AppError('VALIDATION_ERROR', 'Cette marque est archivée.');
      }
    }
    if (
      input.taxRateId !== null &&
      !listTaxRates(this.db).some((tax) => tax.id === input.taxRateId)
    ) {
      throw new AppError('NOT_FOUND', 'Taxe introuvable.');
    }
    if (!allowedTrackingModes(input.productType).includes(input.trackingMode)) {
      throw new AppError(
        'VALIDATION_ERROR',
        input.productType === 'phone'
          ? 'Un téléphone est toujours suivi par IMEI.'
          : 'Un service ou un kit n’a pas de suivi unitaire.',
      );
    }
    if (current !== null) this.assertKitTypeChange(current, input.productType);
    return {
      name: input.name,
      brandId: input.brandId,
      categoryId: input.categoryId,
      model: input.model,
      description: input.description,
      productType: input.productType,
      trackingMode: input.trackingMode,
      isStocked: isStockedType(input.productType),
      taxRateId: input.taxRateId,
      reorderLevel: isStockedType(input.productType) ? input.reorderLevel : 0,
      warrantyMonths: input.warrantyMonths,
      weightKg: input.weightKg,
    };
  }

  /** Un kit qui a des composants reste un kit ; un composant de kit ne devient pas un kit. */
  private assertKitTypeChange(
    current: ProductRecord,
    nextType: ProductRecord['productType'],
  ): void {
    if (current.productType === nextType) return;
    const variantIds = listVariants(this.db, current.id).map((variant) => variant.id);
    const json = JSON.stringify(variantIds);
    const usage = this.db
      .prepare<[string, string], { as_kit: number; as_component: number }>(
        `SELECT EXISTS (SELECT 1 FROM kit_components WHERE kit_variant_id IN (SELECT value FROM json_each(?))) AS as_kit,
                EXISTS (SELECT 1 FROM kit_components WHERE component_variant_id IN (SELECT value FROM json_each(?))) AS as_component`,
      )
      .get(json, json);
    if (current.productType === 'kit' && usage?.as_kit === 1) {
      throw new AppError(
        'CONFLICT',
        'Retirez d’abord les composants du kit pour changer son type.',
      );
    }
    if (nextType === 'kit' && usage?.as_component === 1) {
      throw new AppError(
        'CONFLICT',
        'Ce produit est un composant de kit : il ne peut pas devenir un kit.',
      );
    }
  }

  private checkedAttributes(input: ProductInput) {
    const applicable = effectiveAttributes(
      listCategories(this.db),
      listAttributes(this.db),
      input.categoryId,
    );
    return resolveAttributeValues(applicable, input.attributes);
  }

  private existingVariant(id: number, productId: number): VariantRecord {
    const variant = findVariant(this.db, id);
    if (variant?.productId !== productId) throw new AppError('NOT_FOUND', 'Variante introuvable.');
    return variant;
  }
}

/** Annule la transaction d'import (analyse seule, ou erreurs) sans être une erreur. */
class RollbackSignal extends Error {}

/** Champs modifiés, pour le journal d'audit : { champ: [avant, après] }. */
function changedFields<T extends object>(before: T, after: Partial<T>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const previous: unknown = (before as Record<string, unknown>)[key];
    if (previous !== value) changes[key] = [previous, value];
  }
  return changes;
}
