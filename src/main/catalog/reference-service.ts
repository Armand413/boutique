import { AppError } from '@shared/ipc/errors';
import { categoryChain, descendantIds } from '@shared/catalog/tree';
import type {
  AttributeDefinition,
  Brand,
  CatalogReferences,
  Category,
  SaveAttributeInput,
  SaveBrandInput,
  SaveCategoryInput,
} from '@shared/schemas/catalog';
import { appendAudit } from '../audit/audit-log';
import { requirePermission } from '../auth/authorization';
import type { Session } from '../auth/session';
import type { Db } from '../db/types';
import {
  categoryHoldsProducts,
  findBrandByName,
  insertAttribute,
  insertBrand,
  insertCategory,
  listAttributes,
  listBrands,
  listCategories,
  listLocations,
  listTaxRates,
  updateAttribute,
  updateBrand,
  updateCategory,
  usedTextValues,
} from './reference-repository';

/**
 * Référentiels du catalogue (4.1, 4.12) : familles et catégories, marques, attributs techniques.
 * Consultation avec product.view ; modification réservée à l'administrateur (settings.manage).
 */
export class ReferenceService {
  constructor(private readonly db: Db) {}

  references(actor: Session): CatalogReferences {
    requirePermission(actor, 'product.view');
    return {
      categories: listCategories(this.db),
      brands: listBrands(this.db),
      taxRates: listTaxRates(this.db),
      attributes: listAttributes(this.db),
      locations: listLocations(this.db),
    };
  }

  saveBrand(actor: Session, input: SaveBrandInput): Brand {
    requirePermission(actor, 'settings.manage');
    const homonym = findBrandByName(this.db, input.name);
    if (homonym !== null && homonym.id !== input.id) {
      throw new AppError('CONFLICT', 'Une marque porte déjà ce nom.');
    }
    const id = this.db.transaction(() => {
      const brandId = input.id ?? insertBrand(this.db, input, actor.userId);
      if (input.id !== undefined) {
        this.existingBrand(input.id);
        updateBrand(this.db, input.id, input);
      }
      appendAudit(this.db, {
        userId: actor.userId,
        action: input.id === undefined ? 'catalog.brand_created' : 'catalog.brand_updated',
        entityType: 'brand',
        entityId: brandId,
        details: { name: input.name, isActive: input.isActive },
      });
      return brandId;
    })();
    return this.existingBrand(id);
  }

  saveCategory(actor: Session, input: SaveCategoryInput): Category {
    requirePermission(actor, 'settings.manage');
    const categories = listCategories(this.db);
    const current = input.id === undefined ? null : this.existingCategory(categories, input.id);
    if (input.parentId !== null) this.existingCategory(categories, input.parentId);
    if (current !== null && input.parentId !== current.parentId) {
      if (
        input.parentId !== null &&
        descendantIds(categories, current.id).includes(input.parentId)
      ) {
        throw new AppError('CONFLICT', 'Une catégorie ne peut pas être rangée sous elle-même.');
      }
      if (categoryHoldsProducts(this.db, current.id)) {
        throw new AppError(
          'CONFLICT',
          'Cette catégorie contient des produits : elle ne peut plus changer de famille.',
        );
      }
    }
    const id = this.db.transaction(() => {
      const categoryId = current?.id ?? insertCategory(this.db, input, actor.userId);
      if (current !== null) updateCategory(this.db, current.id, input);
      appendAudit(this.db, {
        userId: actor.userId,
        action: current === null ? 'catalog.category_created' : 'catalog.category_updated',
        entityType: 'category',
        entityId: categoryId,
        details: { ...input },
      });
      return categoryId;
    })();
    return this.existingCategory(listCategories(this.db), id);
  }

  saveAttribute(actor: Session, input: SaveAttributeInput): AttributeDefinition {
    requirePermission(actor, 'settings.manage');
    const categories = listCategories(this.db);
    this.existingCategory(categories, input.categoryId);
    const attributes = listAttributes(this.db);
    const current = input.id === undefined ? null : this.existingAttribute(attributes, input.id);
    this.assertCodeAvailable(categories, attributes, input);
    if (current !== null && current.valueType === 'choice' && input.valueType === 'choice') {
      const kept = new Set(input.choices ?? []);
      const removed = usedTextValues(this.db, current.id).filter((value) => !kept.has(value));
      if (removed.length > 0) {
        throw new AppError(
          'CONFLICT',
          `Choix encore utilisés par des produits : ${removed.slice(0, 5).join(', ')}.`,
        );
      }
    }
    const id = this.db.transaction(() => {
      const attributeId = current?.id ?? insertAttribute(this.db, input, actor.userId);
      if (current !== null) updateAttribute(this.db, current.id, input);
      appendAudit(this.db, {
        userId: actor.userId,
        action: current === null ? 'catalog.attribute_created' : 'catalog.attribute_updated',
        entityType: 'attribute_definition',
        entityId: attributeId,
        details: { ...input },
      });
      return attributeId;
    })();
    return this.existingAttribute(listAttributes(this.db), id);
  }

  /**
   * Un code est unique sur toute la lignée (ancêtres et descendants) : un produit ne voit jamais
   * deux attributs du même code, ce qui garde l'import par colonnes sans ambiguïté.
   */
  private assertCodeAvailable(
    categories: readonly Category[],
    attributes: readonly AttributeDefinition[],
    input: SaveAttributeInput,
  ): void {
    const lineage = new Set([
      ...categoryChain(categories, input.categoryId).map((category) => category.id),
      ...descendantIds(categories, input.categoryId),
    ]);
    const clash = attributes.find(
      (attribute) =>
        attribute.id !== input.id &&
        attribute.code === input.code &&
        lineage.has(attribute.categoryId),
    );
    if (clash !== undefined) {
      throw new AppError(
        'CONFLICT',
        `Le code « ${input.code} » est déjà utilisé dans cette famille.`,
      );
    }
  }

  private existingBrand(id: number): Brand {
    const brand = listBrands(this.db).find((candidate) => candidate.id === id);
    if (brand === undefined) throw new AppError('NOT_FOUND', 'Marque introuvable.');
    return brand;
  }

  private existingCategory(categories: readonly Category[], id: number): Category {
    const category = categories.find((candidate) => candidate.id === id);
    if (category === undefined) throw new AppError('NOT_FOUND', 'Catégorie introuvable.');
    return category;
  }

  private existingAttribute(
    attributes: readonly AttributeDefinition[],
    id: number,
  ): AttributeDefinition {
    const attribute = attributes.find((candidate) => candidate.id === id);
    if (attribute === undefined) throw new AppError('NOT_FOUND', 'Attribut introuvable.');
    return attribute;
  }
}
