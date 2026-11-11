import { app } from 'electron';
import { AppError } from '@shared/ipc/errors';
import type { Session } from '../../auth/session';
import type { PreferencesService } from '../../services/preferences-service';
import type { AppRuntime } from '../../system/runtime';
import type { IpcContext, IpcHandlers } from '../dispatch';

export interface HandlerDependencies {
  preferences: PreferencesService;
  runtime: AppRuntime;
}

/** Session garantie par le contrôle d'accès du canal (jamais null pour un canal « session »). */
function actor(context: IpcContext): Session {
  if (context.session === null)
    throw new AppError('UNAUTHENTICATED', 'Connectez-vous pour continuer.');
  return context.session;
}

export function createHandlers({ preferences, runtime }: HandlerDependencies): IpcHandlers {
  const services = () => runtime.requireServices();
  return {
    'app:getInfo': () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      isPackaged: app.isPackaged,
    }),
    'preferences:get': () => preferences.get(),
    'preferences:set': (patch) => preferences.update(patch),

    'system:getStatus': () => runtime.getStatus(),
    'system:unlockDatabase': ({ recoveryKey }) => runtime.unlockDatabase(recoveryKey),
    'setup:complete': async (input) => ({ recoveryKey: await services().setup.complete(input) }),

    'auth:login': ({ username, password }) => services().auth.login(username, password),
    'auth:loginPin': ({ username, pin }) => services().auth.loginWithPin(username, pin),
    'auth:logout': () => {
      services().auth.logout();
      return null;
    },
    'auth:recoverAdmin': async ({ username, recoveryKey, newPassword }) => ({
      recoveryKey: await services().auth.recoverAdmin(username, recoveryKey, newPassword),
    }),
    'auth:changePassword': ({ currentPassword, newPassword }) =>
      services().auth.changePassword(currentPassword, newPassword),
    'auth:setOwnPin': async ({ currentPassword, pin }) => {
      await services().auth.setOwnPin(currentPassword, pin);
      return null;
    },

    'session:get': () =>
      runtime.getStatus().state === 'ready' ? services().auth.sessionInfo() : null,
    'session:activity': () => null,
    'session:lock': () => services().auth.lock(),
    'session:unlock': ({ secret }) => services().auth.unlock(secret),

    'users:list': (_input, context) => services().users.list(actor(context)),
    'users:create': (input, context) => services().users.create(actor(context), input),
    'users:update': ({ id, ...changes }, context) =>
      services().users.update(actor(context), id, {
        ...(changes.fullName === undefined ? {} : { fullName: changes.fullName }),
        ...(changes.role === undefined ? {} : { role: changes.role }),
        ...(changes.isActive === undefined ? {} : { isActive: changes.isActive }),
      }),
    'users:resetPassword': ({ id, temporaryPassword }, context) =>
      services().users.resetPassword(actor(context), id, temporaryPassword),
    'users:clearPin': ({ id }, context) => services().users.clearPin(actor(context), id),

    'audit:list': ({ limit, beforeId }, context) =>
      services().audit.list(actor(context), limit, beforeId),
    'audit:verify': (_input, context) => services().audit.verify(actor(context)),

    'catalog:references': (_input, context) => services().references.references(actor(context)),
    'brands:save': (input, context) => services().references.saveBrand(actor(context), input),
    'categories:save': (input, context) =>
      services().references.saveCategory(actor(context), input),
    'attributes:save': (input, context) =>
      services().references.saveAttribute(actor(context), input),
    'products:search': (input, context) => services().products.search(actor(context), input),
    'products:get': ({ productId }, context) =>
      services().products.detail(actor(context), productId),
    'products:create': (input, context) => services().products.create(actor(context), input),
    'products:update': (input, context) => services().products.update(actor(context), input),
    'products:setActive': ({ productId, isActive }, context) =>
      services().products.setActive(actor(context), productId, isActive),
    'products:chooseImage': ({ productId }, context) =>
      services().catalogFiles.chooseImage(actor(context), productId),
    'products:clearImage': ({ productId }, context) =>
      services().catalogFiles.clearImage(actor(context), productId),
    'products:image': ({ productId }, context) =>
      services().catalogFiles.image(actor(context), productId),
    'variants:save': (input, context) => services().products.saveVariant(actor(context), input),
    'kits:setComponents': ({ kitVariantId, components }, context) =>
      services().products.setKitComponents(actor(context), kitVariantId, components),
    'serials:find': ({ serial }, context) => services().products.findSerial(actor(context), serial),
    'catalog:export': ({ format }, context) =>
      services().catalogFiles.exportCatalog(actor(context), format),
    'catalog:importAnalyze': (_input, context) =>
      services().catalogFiles.analyzeImport(actor(context)),
    'catalog:importCommit': ({ token }, context) =>
      services().catalogFiles.commitImport(actor(context), token),
    'labels:generate': (input, context) => services().catalogFiles.labels(actor(context), input),
    'locations:list': (_input, context) => services().stock.locations(actor(context)),
    'locations:save': (input, context) => services().stock.saveLocation(actor(context), input),
    'stock:overview': (input, context) => services().stock.overview(actor(context), input),
    'stock:valuation': (_input, context) => services().stock.valuation(actor(context)),
    'stock:alerts': (_input, context) => services().stock.alerts(actor(context)),
    'stock:movements': (input, context) => services().stock.movements(actor(context), input),
    'stock:units': ({ variantId, locationId }, context) =>
      services().stock.availableUnits(actor(context), variantId, locationId),
    'stock:exit': (input, context) => services().stock.exit(actor(context), input),
    'stock:transfer': (input, context) => services().stock.transfer(actor(context), input),
    'suppliers:list': (_input, context) => services().suppliers.list(actor(context)),
    'suppliers:get': ({ supplierId }, context) =>
      services().suppliers.detail(actor(context), supplierId),
    'suppliers:save': (input, context) => services().suppliers.save(actor(context), input),
    'suppliers:pay': (input, context) => services().suppliers.pay(actor(context), input),
    'suppliers:return': (input, context) =>
      services().suppliers.returnToSupplier(actor(context), input),
    'receipts:list': ({ limit }, context) => services().suppliers.receipts(actor(context), limit),
    'receipts:get': ({ receiptId }, context) =>
      services().suppliers.receipt(actor(context), receiptId),
    'receipts:create': (input, context) => services().suppliers.receive(actor(context), input),
    'customers:search': ({ query, limit, withDebtOnly }, context) =>
      services().customers.search(actor(context), query, limit, withDebtOnly ?? false),
    'customers:get': ({ customerId }, context) =>
      services().customers.get(actor(context), customerId),
    'customers:save': (input, context) => services().customers.save(actor(context), input),
    'customers:payDebt': (input, context) => services().customers.payDebt(actor(context), input),
    'cash:current': (_input, context) => services().cashSessions.current(actor(context)),
    'cash:open': ({ openingFloat }, context) =>
      services().cashSessions.open(actor(context), openingFloat),
    'cash:move': ({ direction, amount, reason }, context) =>
      services().cashSessions.move(actor(context), direction, amount, reason),
    'cash:close': ({ countedCash, notes }, context) =>
      services().cashSessions.close(actor(context), countedCash, notes),
    'cash:list': ({ limit }, context) => services().cashSessions.list(actor(context), limit),
    'sales:preview': ({ lines, globalDiscount, quoteId }, context) =>
      services().sales.preview(actor(context), lines, globalDiscount, quoteId),
    'sales:checkout': (input, context) => services().sales.checkout(actor(context), input),
    'sales:hold': (input, context) => services().sales.hold(actor(context), input),
    'sales:held': (_input, context) => services().sales.heldSales(actor(context)),
    'sales:resume': ({ saleId }, context) => services().sales.resume(actor(context), saleId),
    'sales:discard': ({ saleId }, context) => {
      services().sales.discard(actor(context), saleId);
      return null;
    },
    'sales:list': (input, context) => services().sales.list(actor(context), input),
    'sales:get': ({ saleId }, context) => services().sales.detail(actor(context), saleId),
    'sales:cancel': ({ saleId, reason }, context) =>
      services().sales.cancel(actor(context), saleId, reason),
    'sales:return': (input, context) => services().sales.returnItems(actor(context), input),
    'quotes:list': ({ status, limit }, context) =>
      services().quotes.list(actor(context), status, limit),
    'quotes:get': ({ quoteId }, context) => services().quotes.get(actor(context), quoteId),
    'quotes:save': (input, context) => services().quotes.save(actor(context), input),
    'quotes:setStatus': ({ quoteId, status }, context) =>
      services().quotes.setStatus(actor(context), quoteId, status),
    'quotes:toCart': ({ quoteId }, context) => services().quotes.toCart(actor(context), quoteId),
    'installments:list': ({ scope, limit }, context) =>
      services().followups.installments(actor(context), scope, limit),
    'deliveries:list': ({ status, limit }, context) =>
      services().followups.deliveries(actor(context), status, limit),
    'deliveries:update': ({ deliveryId, status }, context) => {
      services().followups.updateDelivery(actor(context), deliveryId, status);
      return null;
    },
    'documents:ticketText': ({ saleId }, context) => ({
      lines: services().documents.ticketText(actor(context), saleId),
    }),
    'documents:printTicket': ({ saleId }, context) =>
      services().documents.printTicket(actor(context), saleId),
    'documents:saveSale': ({ saleId, kind }, context) =>
      services().documents.saveSaleDocument(actor(context), saleId, kind),
    'inventory:list': ({ limit }, context) => services().inventories.list(actor(context), limit),
    'inventory:get': ({ inventoryId }, context) =>
      services().inventories.detail(actor(context), inventoryId),
    'inventory:create': (input, context) => services().inventories.create(actor(context), input),
    'inventory:setCount': ({ inventoryId, lineId, counted, note }, context) =>
      services().inventories.setCount(actor(context), inventoryId, lineId, counted, note),
    'inventory:scan': ({ inventoryId, code }, context) =>
      services().inventories.scan(actor(context), inventoryId, code),
    'inventory:removeScan': ({ inventoryId, unitId }, context) =>
      services().inventories.removeScan(actor(context), inventoryId, unitId),
    'inventory:zeroUncounted': ({ inventoryId }, context) =>
      services().inventories.zeroUncounted(actor(context), inventoryId),
    'inventory:finish': ({ inventoryId }, context) =>
      services().inventories.finishCounting(actor(context), inventoryId),
    'inventory:resume': ({ inventoryId }, context) =>
      services().inventories.resumeCounting(actor(context), inventoryId),
    'inventory:validate': ({ inventoryId }, context) =>
      services().inventories.validate(actor(context), inventoryId),
    'inventory:cancel': ({ inventoryId }, context) =>
      services().inventories.cancel(actor(context), inventoryId),
    'inventory:export': ({ inventoryId, format }, context) =>
      services().inventoryReport.export(actor(context), inventoryId, format),
    'warranty:lookup': ({ serial }, context) => services().warranty.lookup(actor(context), serial),
    'warranty:open': ({ serialUnitId, issue, supplierId }, context) =>
      services().warranty.open(actor(context), serialUnitId, issue, supplierId),
    'warranty:update': (input, context) => services().warranty.update(actor(context), input),
    'warranty:list': ({ scope, limit }, context) =>
      services().warranty.list(actor(context), scope, limit),
    'warranty:expiring': (_input, context) => services().warranty.expiring(actor(context)),
    'dashboard:get': (_input, context) => services().reports.dashboard(actor(context)),
    'reports:run': (request, context) => services().reports.run(actor(context), request),
    'reports:export': ({ request, format }, context) =>
      services().reports.export(actor(context), request, format),
    'sales:units': ({ variantId }, context) =>
      services().sales.availableUnits(actor(context), variantId),
    'documents:saveQuote': ({ quoteId }, context) =>
      services().documents.saveQuote(actor(context), quoteId),
  };
}
