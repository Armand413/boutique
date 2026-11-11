import { join } from 'node:path';
import type { Role } from '../../../src/shared/permissions';
import type { CreateProductInput, VariantInput } from '../../../src/shared/schemas/catalog';
import { SessionManager, type Session } from '../../../src/main/auth/session';
import { CatalogFilesService } from '../../../src/main/catalog/catalog-files-service';
import { ImageStore } from '../../../src/main/catalog/image-store';
import { ProductService } from '../../../src/main/catalog/product-service';
import { ReferenceService } from '../../../src/main/catalog/reference-service';
import { createTestDatabase, insertUser, type TestDatabase } from '../db/helpers';
import { fakeDialogs } from '../auth/harness';

export interface CatalogHarness {
  test: TestDatabase;
  references: ReferenceService;
  products: ProductService;
  files: CatalogFilesService;
  dialogs: ReturnType<typeof fakeDialogs>['state'];
  as: (role: Role, method?: 'password' | 'pin') => Session;
  family: (name: string) => number;
  cleanup: () => void;
}

export function createCatalogHarness(): CatalogHarness {
  const test = createTestDatabase();
  const users: Partial<Record<Role, number>> = {};
  const sessions = new SessionManager();
  const products = new ProductService(test.db);
  const fake = fakeDialogs();
  return {
    test,
    references: new ReferenceService(test.db),
    products,
    files: new CatalogFilesService({
      db: test.db,
      products,
      dialogs: fake.dialogs,
      images: new ImageStore(join(test.directory, 'images')),
    }),
    dialogs: fake.state,
    as: (role, method = 'password') => {
      users[role] ??= insertUser(test.db, `user_${role}`, role);
      return sessions.start({
        userId: users[role],
        username: `user_${role}`,
        fullName: role,
        role,
        method,
        mustChangePassword: false,
        idleLockMs: 3_600_000,
      });
    },
    family: (name) =>
      test.db
        .prepare('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL')
        .pluck()
        .get(name) as number,
    cleanup: () => test.cleanup(),
  };
}

export function variant(overrides: Partial<VariantInput> = {}): VariantInput {
  return {
    sku: '',
    barcode: null,
    color: null,
    storageGb: null,
    ramGb: null,
    condition: 'new',
    salePrice: 10_000,
    minSalePrice: 0,
    isActive: true,
    ...overrides,
  };
}

export function productInput(
  categoryId: number,
  overrides: Partial<CreateProductInput> = {},
): CreateProductInput {
  return {
    name: 'Câble USB-C',
    brandId: null,
    categoryId,
    model: null,
    description: null,
    productType: 'accessory',
    trackingMode: 'none',
    taxRateId: null,
    reorderLevel: 0,
    warrantyMonths: 0,
    weightKg: null,
    attributes: [],
    variants: [variant()],
    ...overrides,
  };
}
