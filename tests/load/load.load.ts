import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionManager, type Session } from '../../src/main/auth/session';
import { ProductService } from '../../src/main/catalog/product-service';
import { ReferenceService } from '../../src/main/catalog/reference-service';
import { closeDatabase, integrityProblems, openDatabase } from '../../src/main/db/connection';
import { bundledMigrations, pendingMigrations } from '../../src/main/db/migrations';
import { localDay } from '../../src/main/reports/period';
import { dashboard, runReport } from '../../src/main/reports/report-queries';
import { snapshot } from '../../src/main/reports/report-tasks';
import { CashSessionService } from '../../src/main/sales/cash-session-service';
import { CustomerService } from '../../src/main/sales/customer-service';
import { SaleService } from '../../src/main/sales/sale-service';
import { SupplierService } from '../../src/main/stock/supplier-service';
import type { ReportRequest } from '../../src/shared/schemas/reports';
import {
  DEMO_SCALE,
  LOAD_SCALE,
  generate,
  type GeneratedSummary,
} from '../../tools/demo/generator';
import { createTestDatabase, insertUser, type TestDatabase } from '../unit/db/helpers';

/**
 * Test de charge (phase 9, 5.1) : 50 000 produits, 100 000 ventes, 500 000 mouvements, puis mesure
 * des temps cibles. `BOUTIQUE_LOAD=demo` lance la même chose à l'échelle de démonstration.
 */
const scale = process.env.BOUTIQUE_LOAD === 'demo' ? DEMO_SCALE : LOAD_SCALE;
let test: TestDatabase;
let summary: GeneratedSummary;
let admin: Session;
let seller: Session;
const timings: Record<string, number> = {};

function services() {
  const { db } = test;
  return {
    db,
    references: new ReferenceService(db),
    products: new ProductService(db),
    suppliers: new SupplierService(db),
    customers: new CustomerService(db),
    cashSessions: new CashSessionService(db),
    sales: new SaleService(db),
  };
}

function session(manager: SessionManager, role: 'admin' | 'seller', name: string): Session {
  return manager.start({
    userId: insertUser(test.db, name, role),
    username: name,
    fullName: name,
    role,
    method: 'password',
    mustChangePassword: false,
    idleLockMs: 3_600_000,
  });
}

/** Pire de `runs` mesures après une mesure d'échauffement (en millisecondes). */
function worst(name: string, runs: number, action: () => unknown): number {
  action();
  let max = 0;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    action();
    max = Math.max(max, performance.now() - started);
  }
  timings[name] = Math.round(max * 10) / 10;
  return max;
}

beforeAll(async () => {
  test = createTestDatabase();
  const manager = new SessionManager();
  admin = session(manager, 'admin', 'chef');
  seller = session(manager, 'seller', 'awa');
  const sellers = [seller, ...['koffi', 'yao'].map((name) => session(manager, 'seller', name))];
  summary = await generate(services(), { admin, sellers }, scale, (message) => {
    process.stdout.write(`[charge] ${message}\n`);
  });
  process.stdout.write(`[charge] ${JSON.stringify(summary)}\n`);
});

afterAll(() => {
  const directory = join(process.cwd(), 'test-results');
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `charge-${process.env.BOUTIQUE_LOAD ?? 'complete'}.json`),
    JSON.stringify({ scale, summary, timings }, null, 2),
  );
  test.cleanup();
});

describe('volume généré', () => {
  it('atteint les volumes visés sans refus inattendu', () => {
    expect(summary.products).toBeGreaterThanOrEqual(scale.products);
    expect(summary.sales).toBeGreaterThanOrEqual(scale.sales * 0.95);
    if (scale === LOAD_SCALE) expect(summary.movements).toBeGreaterThanOrEqual(500_000);
    expect(test.db.prepare('SELECT count(*) FROM v_stock_discrepancies').pluck().get()).toBe(0);
  });
});

describe('temps cibles (5.1)', () => {
  it('recherche produit sous 100 ms', () => {
    const products = new ProductService(test.db);
    for (const query of [
      'galaxy',
      'câble',
      'panneau 450',
      'batterie lithium',
      '2000004',
      'smart tv 55',
    ]) {
      worst(`recherche « ${query} »`, 5, () =>
        products.search(admin, { query, status: 'active', sort: 'name', offset: 0, limit: 50 }),
      );
    }
    const slowest = Math.max(
      ...Object.entries(timings)
        .filter(([key]) => key.startsWith('recherche'))
        .map(([, value]) => value),
    );
    expect(slowest).toBeLessThan(100);
  });

  it('ajout au panier sous 50 ms et validation d’une vente sous 500 ms', () => {
    const { sales, cashSessions } = services();
    const variants = test.db
      .prepare<[], number>(
        `SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
         JOIN stock_levels l ON l.variant_id = v.id
         WHERE p.tracking_mode = 'none' AND p.product_type <> 'kit' AND l.quantity >= 5 LIMIT 3`,
      )
      .pluck()
      .all();
    const lines = variants.map((variantId) => ({ variantId, quantity: 1, discount: null }));
    expect(
      worst('panier (3 lignes)', 10, () => sales.preview(seller, lines, null, null)),
    ).toBeLessThan(50);
    cashSessions.open(admin, 0);
    const total = sales.preview(seller, lines, null, null).total;
    const started = performance.now();
    sales.checkout(seller, {
      customerId: null,
      lines,
      globalDiscount: null,
      payments: [{ method: 'cash', amount: total, reference: null }],
      installments: null,
      delivery: null,
    });
    timings['validation d’une vente'] = Math.round(performance.now() - started);
    expect(timings['validation d’une vente']).toBeLessThan(500);
  });

  it('rouvre la base (contrôle d’intégrité compris) sous 3 s', () => {
    closeDatabase(test.db);
    const started = performance.now();
    test.db = openDatabase(test.file, test.key);
    expect(integrityProblems(test.db)).toEqual([]);
    expect(pendingMigrations(test.db, bundledMigrations())).toEqual([]);
    timings['ouverture + integrity_check'] = Math.round(performance.now() - started);
    expect(timings['ouverture + integrity_check']).toBeLessThan(3000);
  });

  it('calcule tableau de bord et rapports dans le thread des rapports en temps raisonnable', () => {
    const now = new Date();
    const year = { from: `${String(now.getFullYear())}-01-01`, to: localDay(now) };
    const context = { canSeeCost: true, now, limit: 2000 };
    timings['tableau de bord'] = Math.round(
      worst('tableau de bord', 2, () =>
        dashboard(test.db, { canSeeCost: true, canSeeStock: true, canSeeAudit: true, now }),
      ),
    );
    const requests: ReportRequest[] = [
      { kind: 'sales', period: year, groupBy: 'family' },
      { kind: 'sales', period: year, groupBy: 'product' },
      { kind: 'products', period: year, order: 'worst' },
      { kind: 'stock', groupBy: 'brand' },
      { kind: 'balances' },
      { kind: 'movements', period: year, movementType: null },
      { kind: 'cash', period: year },
      { kind: 'followups' },
      { kind: 'sensitive', period: year },
    ];
    for (const request of requests) {
      const label = `rapport ${request.kind}${'groupBy' in request ? ` / ${request.groupBy}` : ''}`;
      worst(label, 1, () => runReport(test.db, request, context));
    }
    const slowest = Math.max(
      ...Object.entries(timings)
        .filter(([key]) => key.startsWith('rapport') || key === 'tableau de bord')
        .map(([, value]) => value),
    );
    process.stdout.write(`[charge] ${JSON.stringify(timings, null, 2)}\n`);
    expect(slowest).toBeLessThan(10_000);
  });

  it('copie la base pour une sauvegarde', () => {
    const target = join(test.directory, 'copie.db');
    const started = performance.now();
    snapshot(test.db, target);
    timings['copie VACUUM INTO'] = Math.round(performance.now() - started);
    rmSync(target, { force: true });
    expect(timings['copie VACUUM INTO']).toBeLessThan(60_000);
  });
});
