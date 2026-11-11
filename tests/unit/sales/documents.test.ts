import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentService } from '../../../src/main/printing/document-service';
import { ticketLines } from '../../../src/main/printing/receipt';
import { fakeDialogs } from '../auth/harness';
import { createSalesHarness, variant, type SalesHarness } from './harness';

vi.mock('../../../src/main/logging/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let h: SalesHarness;
let documents: DocumentService;
let dialogs: ReturnType<typeof fakeDialogs>['state'];
const IMEI = '490154203237518';

beforeEach(() => {
  h = createSalesHarness();
  const fake = fakeDialogs();
  dialogs = fake.state;
  documents = new DocumentService({
    db: h.test.db,
    dialogs: fake.dialogs,
    quotes: h.quotes,
    customers: h.customers,
    simulatorDirectory: join(h.test.directory, 'tickets'),
  });
  h.test.db
    .prepare("UPDATE settings SET value = '\"Boutique du Plateau\"' WHERE key = 'shop.name'")
    .run();
});

afterEach(() => {
  h.cleanup();
});

function sellPhone() {
  const tax = h.test.db
    .prepare('SELECT id FROM tax_rates WHERE rate = 1800')
    .pluck()
    .get() as number;
  const variantId = h.product(
    {
      name: 'Galaxy A15',
      productType: 'phone',
      trackingMode: 'imei',
      warrantyMonths: 12,
      taxRateId: tax,
      variants: [variant({ salePrice: 118_000 })],
    },
    1,
    [IMEI],
  );
  const unit = h.test.db
    .prepare('SELECT id FROM serial_units WHERE serial_number = ?')
    .pluck()
    .get(IMEI) as number;
  h.sessions.open(h.manager, 0);
  const client = h.customers.save(h.manager, {
    fullName: 'Aya Koné',
    phone: null,
    address: null,
    notes: null,
    creditLimit: 100_000,
    isActive: true,
  });
  return h.sales.checkout(
    h.manager,
    h.checkoutInput({
      customerId: client.id,
      lines: [{ variantId, quantity: 1, discount: null, serialUnitIds: [unit] }],
      payments: [{ method: 'cash', amount: 100_000, reference: null }],
      installments: [{ dueDate: '2099-01-31', amount: 18_000 }],
    }),
  );
}

describe('ticket de caisse', () => {
  it('détaille l’IMEI, la garantie, la TVA comprise et le reste à payer, dans la largeur du rouleau', () => {
    const sale = sellPhone();
    const lines = ticketLines(sale, 'Boutique du Plateau', 32);
    expect(lines.every((line) => line.length <= 32)).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain(`N° ${IMEI}`);
    expect(text).toMatch(/Garantie jusqu'au \d{4}-\d{2}-\d{2}/);
    expect(text).toMatch(/TOTAL TTC\s+118 000 FCFA/);
    expect(text).toMatch(/dont TVA\s+18 000 FCFA/);
    expect(text).toMatch(/Reste à payer\s+18 000 FCFA/);
  });

  it('imprime sur le simulateur quand aucune imprimante n’est configurée', async () => {
    const sale = sellPhone();
    expect(await documents.printTicket(h.manager, sale.id)).toEqual({ simulated: true });
    const [file] = readdirSync(join(h.test.directory, 'tickets'));
    expect(file).toBe(`${sale.invoiceNumber ?? ''}.escpos`);
    const bytes = readFileSync(join(h.test.directory, 'tickets', file ?? ''));
    // ESC t : sélection du jeu de caractères (accents), puis GS V : coupe du papier.
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x74]);
    expect(bytes.includes(Buffer.from([0x1d, 0x56]))).toBe(true);
    expect(bytes.toString('latin1')).toContain('Boutique du Plateau');
  });
});

describe('documents PDF', () => {
  it('enregistre facture, bon de garantie et devis', async () => {
    const sale = sellPhone();
    for (const kind of ['invoice', 'warranty', 'ticket'] as const) {
      const path = join(h.test.directory, `${kind}.pdf`);
      dialogs.save = path;
      expect(await documents.saveSaleDocument(h.manager, sale.id, kind)).toEqual({ saved: true });
      expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await expect(documents.saveSaleDocument(h.manager, sale.id, 'delivery_note')).rejects.toThrow(
      /pas de livraison/,
    );
    const cable = h.product({ name: 'Câble', variants: [variant({ salePrice: 2500 })] }, 3);
    const quote = h.quotes.save(h.manager, {
      customerId: null,
      validUntil: '2099-12-31',
      reserveStock: false,
      notes: 'Pose comprise',
      lines: [{ variantId: cable, quantity: 2, discount: null }],
      globalDiscount: null,
    });
    dialogs.save = join(h.test.directory, 'devis.pdf');
    expect(await documents.saveQuote(h.manager, quote.quote.id)).toEqual({ saved: true });
    dialogs.save = null;
    expect(await documents.saveSaleDocument(h.manager, sale.id, 'invoice')).toEqual({
      saved: false,
    });
  });

  it('refuse les documents de vente sans droit de caisse ni de consultation', async () => {
    const sale = sellPhone();
    const nobody = { ...h.manager, permissions: new Set<never>() };
    await expect(documents.printTicket(nobody, sale.id)).rejects.toThrow(/droit/);
  });
});
