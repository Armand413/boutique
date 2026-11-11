import type { Session } from '../../../src/main/auth/session';
import { CashSessionService } from '../../../src/main/sales/cash-session-service';
import { CustomerService } from '../../../src/main/sales/customer-service';
import { FollowupService } from '../../../src/main/sales/followup-service';
import { QuoteService } from '../../../src/main/sales/quote-service';
import { SaleService } from '../../../src/main/sales/sale-service';
import { StockService } from '../../../src/main/stock/stock-service';
import { SupplierService } from '../../../src/main/stock/supplier-service';
import type { CheckoutInput } from '../../../src/shared/schemas/sales';
import type { CreateProductInput } from '../../../src/shared/schemas/catalog';
import {
  createCatalogHarness,
  productInput,
  variant,
  type CatalogHarness,
} from '../catalog/harness';

export interface SalesHarness extends CatalogHarness {
  sales: SaleService;
  sessions: CashSessionService;
  customers: CustomerService;
  quotes: QuoteService;
  followups: FollowupService;
  stock: StockService;
  suppliers: SupplierService;
  manager: Session;
  /** Crée un produit (une variante) et en reçoit `quantity` (IMEI fournis si suivi). */
  product: (
    overrides: Partial<CreateProductInput>,
    quantity?: number,
    serials?: string[],
  ) => number;
  checkoutInput: (overrides: Partial<CheckoutInput>) => CheckoutInput;
  stockOf: (variantId: number) => number;
}

let supplierId: number | null = null;

export function createSalesHarness(): SalesHarness {
  const base = createCatalogHarness();
  supplierId = null;
  const db = base.test.db;
  const suppliers = new SupplierService(db);
  const manager = base.as('manager');
  const location = (): number =>
    db.prepare('SELECT id FROM stock_locations WHERE is_default = 1').pluck().get() as number;
  const harness: SalesHarness = {
    ...base,
    sales: new SaleService(db),
    sessions: new CashSessionService(db),
    customers: new CustomerService(db),
    quotes: new QuoteService(db),
    followups: new FollowupService(db),
    stock: new StockService(db),
    suppliers,
    manager,
    product: (overrides, quantity = 0, serials = []) => {
      const created = base.products.create(
        base.as('admin'),
        productInput(base.family('Téléphonie'), overrides),
      );
      const variantId = created.variants[0]?.id ?? 0;
      if (quantity > 0) {
        supplierId ??= suppliers.save(base.as('admin'), {
          name: 'Fournisseur test',
          phone: null,
          email: null,
          address: null,
          notes: null,
          isActive: true,
        }).id;
        suppliers.receive(base.as('admin'), {
          supplierId,
          locationId: location(),
          receivedOn: '2026-11-11',
          notes: null,
          lines: [
            {
              variantId,
              quantity,
              unitCost: 1000,
              ...(serials.length === 0
                ? {}
                : { serials: serials.map((serialNumber) => ({ serialNumber, imei2: null })) }),
            },
          ],
          payment: null,
        });
      }
      return variantId;
    },
    checkoutInput: (overrides) => ({
      customerId: null,
      lines: [],
      globalDiscount: null,
      payments: [],
      installments: null,
      delivery: null,
      ...overrides,
    }),
    stockOf: (variantId) =>
      db
        .prepare('SELECT coalesce(sum(quantity), 0) FROM stock_levels WHERE variant_id = ?')
        .pluck()
        .get(variantId) as number,
  };
  return harness;
}

export { variant };
