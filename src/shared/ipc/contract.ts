import { z } from 'zod';
import type { IpcChannel } from './channels';
import type { Permission } from '../permissions';
import { preferencesPatchSchema, preferencesSchema } from '../schemas/preferences';
import {
  auditEntrySchema,
  auditListInputSchema,
  auditVerificationSchema,
  changePasswordInputSchema,
  createUserInputSchema,
  loginInputSchema,
  pinLoginInputSchema,
  recoveryKeyOutputSchema,
  recoveryResetInputSchema,
  resetPasswordInputSchema,
  sessionInfoSchema,
  setOwnPinInputSchema,
  setupInputSchema,
  systemStatusSchema,
  unlockDatabaseInputSchema,
  unlockSessionInputSchema,
  updateUserInputSchema,
  userIdInputSchema,
  userSummarySchema,
} from '../schemas/auth';
import {
  attributeDefinitionSchema,
  brandSchema,
  catalogReferencesSchema,
  categorySchema,
  createProductInputSchema,
  exportInputSchema,
  exportOutputSchema,
  importAnalysisSchema,
  importCommitInputSchema,
  importCommitOutputSchema,
  kitComponentsInputSchema,
  labelsInputSchema,
  productDetailSchema,
  productIdInputSchema,
  productImageOutputSchema,
  productSearchInputSchema,
  productSearchOutputSchema,
  saveAttributeInputSchema,
  saveBrandInputSchema,
  saveCategoryInputSchema,
  saveVariantInputSchema,
  savedFileOutputSchema,
  serialLookupInputSchema,
  serialLookupSchema,
  setProductActiveInputSchema,
  updateProductInputSchema,
} from '../schemas/catalog';
import {
  availableUnitSchema,
  availableUnitsInputSchema,
  createReceiptInputSchema,
  locationSchema,
  movementListInputSchema,
  movementSchema,
  receiptDetailSchema,
  receiptIdInputSchema,
  receiptListInputSchema,
  receiptSummarySchema,
  saveLocationInputSchema,
  saveSupplierInputSchema,
  stockAlertsSchema,
  stockExitInputSchema,
  stockOverviewInputSchema,
  stockOverviewOutputSchema,
  supplierDetailSchema,
  supplierIdInputSchema,
  supplierPaymentInputSchema,
  supplierReturnInputSchema,
  supplierSchema,
  transferInputSchema,
  valuationSchema,
} from '../schemas/stock';
import {
  cancelSaleInputSchema,
  cartPreviewSchema,
  cashMovementInputSchema,
  cashSessionSchema,
  checkoutInputSchema,
  closeSessionInputSchema,
  customerIdInputSchema,
  customerSchema,
  customerSearchInputSchema,
  debtPaymentInputSchema,
  deliveryListInputSchema,
  deliveryRowSchema,
  deliveryUpdateInputSchema,
  documentInputSchema,
  heldCartSchema,
  heldSaleSchema,
  holdInputSchema,
  installmentListInputSchema,
  installmentRowSchema,
  openSessionInputSchema,
  previewInputSchema,
  printedSchema,
  quoteCartSchema,
  quoteDetailSchema,
  quoteDocumentInputSchema,
  quoteIdInputSchema,
  quoteListInputSchema,
  quoteStatusInputSchema,
  quoteSummarySchema,
  returnInputSchema,
  saleDetailSchema,
  saleIdInputSchema,
  saleListInputSchema,
  saleSummarySchema,
  saleUnitSchema,
  saleUnitsInputSchema,
  saveCustomerInputSchema,
  saveQuoteInputSchema,
  savedSchema,
  sessionListInputSchema,
  ticketTextSchema,
} from '../schemas/sales';

export const appInfoSchema = z.strictObject({
  name: z.string().min(1),
  version: z.string().min(1),
  electron: z.string().min(1),
  chrome: z.string().min(1),
  node: z.string().min(1),
  isPackaged: z.boolean(),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/**
 * Accès exigé par un canal, contrôlé par le processus principal avant l'appel du service.
 * - public : sans session (démarrage, connexion) ;
 * - session : session ouverte et déverrouillée, éventuellement avec une permission.
 */
export type IpcAccess =
  | { kind: 'public' }
  | {
      kind: 'session';
      permission?: Permission;
      allowLocked?: true;
      allowPasswordChange?: true;
      /** Compte comme une activité de l'utilisateur (par défaut : oui). */
      touches?: false;
    };

const PUBLIC: IpcAccess = { kind: 'public' };
const SESSION: IpcAccess = { kind: 'session' };
const needs = (permission: Permission): IpcAccess => ({ kind: 'session', permission });

const noInput = z.undefined();
const hasImage = z.strictObject({ hasImage: z.boolean(), changed: z.boolean() });
const nothing = z.null();

/**
 * Contrat de chaque canal : schémas d'entrée et de sortie, et accès requis.
 * Le processus principal valide tout ; l'interface en déduit ses types.
 */
export const ipcContract = {
  'app:getInfo': { input: noInput, output: appInfoSchema, access: PUBLIC },
  'preferences:get': { input: noInput, output: preferencesSchema, access: PUBLIC },
  'preferences:set': { input: preferencesPatchSchema, output: preferencesSchema, access: PUBLIC },
  'system:getStatus': { input: noInput, output: systemStatusSchema, access: PUBLIC },
  'system:unlockDatabase': {
    input: unlockDatabaseInputSchema,
    output: systemStatusSchema,
    access: PUBLIC,
  },
  'setup:complete': { input: setupInputSchema, output: recoveryKeyOutputSchema, access: PUBLIC },
  'auth:login': { input: loginInputSchema, output: sessionInfoSchema, access: PUBLIC },
  'auth:loginPin': { input: pinLoginInputSchema, output: sessionInfoSchema, access: PUBLIC },
  'auth:logout': { input: noInput, output: nothing, access: PUBLIC },
  'auth:recoverAdmin': {
    input: recoveryResetInputSchema,
    output: recoveryKeyOutputSchema,
    access: PUBLIC,
  },
  'auth:changePassword': {
    input: changePasswordInputSchema,
    output: sessionInfoSchema,
    access: { kind: 'session', allowPasswordChange: true },
  },
  'auth:setOwnPin': { input: setOwnPinInputSchema, output: nothing, access: SESSION },
  'session:get': { input: noInput, output: sessionInfoSchema.nullable(), access: PUBLIC },
  'session:activity': { input: noInput, output: nothing, access: SESSION },
  'session:lock': {
    input: noInput,
    output: sessionInfoSchema,
    access: { kind: 'session', allowPasswordChange: true, touches: false },
  },
  'session:unlock': {
    input: unlockSessionInputSchema,
    output: sessionInfoSchema,
    access: { kind: 'session', allowLocked: true, touches: false },
  },
  'users:list': {
    input: noInput,
    output: z.array(userSummarySchema),
    access: needs('user.manage'),
  },
  'users:create': {
    input: createUserInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'users:update': {
    input: updateUserInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'users:resetPassword': {
    input: resetPasswordInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'users:clearPin': {
    input: userIdInputSchema,
    output: userSummarySchema,
    access: needs('user.manage'),
  },
  'audit:list': {
    input: auditListInputSchema,
    output: z.array(auditEntrySchema),
    access: needs('audit.view'),
  },
  'audit:verify': { input: noInput, output: auditVerificationSchema, access: needs('audit.view') },
  'catalog:references': {
    input: noInput,
    output: catalogReferencesSchema,
    access: needs('product.view'),
  },
  'brands:save': {
    input: saveBrandInputSchema,
    output: brandSchema,
    access: needs('settings.manage'),
  },
  'categories:save': {
    input: saveCategoryInputSchema,
    output: categorySchema,
    access: needs('settings.manage'),
  },
  'attributes:save': {
    input: saveAttributeInputSchema,
    output: attributeDefinitionSchema,
    access: needs('settings.manage'),
  },
  'products:search': {
    input: productSearchInputSchema,
    output: productSearchOutputSchema,
    access: needs('product.view'),
  },
  'products:get': {
    input: productIdInputSchema,
    output: productDetailSchema,
    access: needs('product.view'),
  },
  'products:create': {
    input: createProductInputSchema,
    output: productDetailSchema,
    access: needs('product.edit'),
  },
  'products:update': {
    input: updateProductInputSchema,
    output: productDetailSchema,
    access: needs('product.edit'),
  },
  'products:setActive': {
    input: setProductActiveInputSchema,
    output: productDetailSchema,
    access: needs('product.edit'),
  },
  'products:chooseImage': {
    input: productIdInputSchema,
    output: hasImage,
    access: needs('product.edit'),
  },
  'products:clearImage': {
    input: productIdInputSchema,
    output: hasImage,
    access: needs('product.edit'),
  },
  'products:image': {
    input: productIdInputSchema,
    output: productImageOutputSchema,
    access: needs('product.view'),
  },
  'variants:save': {
    input: saveVariantInputSchema,
    output: productDetailSchema,
    access: needs('product.edit'),
  },
  'kits:setComponents': {
    input: kitComponentsInputSchema,
    output: productDetailSchema,
    access: needs('product.edit'),
  },
  'serials:find': {
    input: serialLookupInputSchema,
    output: z.array(serialLookupSchema),
    access: needs('product.view'),
  },
  'catalog:export': {
    input: exportInputSchema,
    output: exportOutputSchema,
    access: needs('export.run'),
  },
  'catalog:importAnalyze': {
    input: noInput,
    output: importAnalysisSchema,
    access: needs('product.edit'),
  },
  'catalog:importCommit': {
    input: importCommitInputSchema,
    output: importCommitOutputSchema,
    access: needs('product.edit'),
  },
  'labels:generate': {
    input: labelsInputSchema,
    output: savedFileOutputSchema,
    access: needs('product.view'),
  },
  'locations:list': {
    input: noInput,
    output: z.array(locationSchema),
    access: needs('stock.view'),
  },
  'locations:save': {
    input: saveLocationInputSchema,
    output: locationSchema,
    access: needs('settings.manage'),
  },
  'stock:overview': {
    input: stockOverviewInputSchema,
    output: stockOverviewOutputSchema,
    access: needs('stock.view'),
  },
  'stock:valuation': {
    input: noInput,
    output: valuationSchema,
    access: needs('stock.view'),
  },
  'stock:alerts': {
    input: noInput,
    output: stockAlertsSchema,
    access: needs('stock.view'),
  },
  'stock:movements': {
    input: movementListInputSchema,
    output: z.array(movementSchema),
    access: needs('stock.view'),
  },
  'stock:units': {
    input: availableUnitsInputSchema,
    output: z.array(availableUnitSchema),
    access: needs('stock.view'),
  },
  'stock:exit': {
    input: stockExitInputSchema,
    output: z.strictObject({ movements: z.number().int() }),
    access: needs('stock.adjust'),
  },
  'stock:transfer': {
    input: transferInputSchema,
    output: z.strictObject({ transferId: z.number().int() }),
    access: needs('stock.adjust'),
  },
  'suppliers:list': {
    input: noInput,
    output: z.array(supplierSchema),
    access: needs('supplier.manage'),
  },
  'suppliers:get': {
    input: supplierIdInputSchema,
    output: supplierDetailSchema,
    access: needs('supplier.manage'),
  },
  'suppliers:save': {
    input: saveSupplierInputSchema,
    output: supplierSchema,
    access: needs('supplier.manage'),
  },
  'suppliers:pay': {
    input: supplierPaymentInputSchema,
    output: supplierSchema,
    access: needs('supplier.manage'),
  },
  'suppliers:return': {
    input: supplierReturnInputSchema,
    output: z.strictObject({ movements: z.number().int() }),
    access: needs('stock.adjust'),
  },
  'receipts:list': {
    input: receiptListInputSchema,
    output: z.array(receiptSummarySchema),
    access: needs('stock.adjust'),
  },
  'receipts:get': {
    input: receiptIdInputSchema,
    output: receiptDetailSchema,
    access: needs('stock.adjust'),
  },
  'receipts:create': {
    input: createReceiptInputSchema,
    output: receiptDetailSchema,
    access: needs('stock.adjust'),
  },
  'customers:search': {
    input: customerSearchInputSchema,
    output: z.array(customerSchema),
    access: needs('customer.manage'),
  },
  'customers:get': {
    input: customerIdInputSchema,
    output: customerSchema,
    access: needs('customer.manage'),
  },
  'customers:save': {
    input: saveCustomerInputSchema,
    output: customerSchema,
    access: needs('customer.manage'),
  },
  'customers:payDebt': {
    input: debtPaymentInputSchema,
    output: customerSchema,
    access: needs('pos.use'),
  },
  'cash:current': {
    input: noInput,
    output: cashSessionSchema.nullable(),
    access: needs('pos.use'),
  },
  'cash:open': {
    input: openSessionInputSchema,
    output: cashSessionSchema,
    access: needs('pos.use'),
  },
  'cash:move': {
    input: cashMovementInputSchema,
    output: cashSessionSchema,
    access: needs('pos.use'),
  },
  'cash:close': {
    input: closeSessionInputSchema,
    output: cashSessionSchema,
    access: needs('pos.use'),
  },
  'cash:list': {
    input: sessionListInputSchema,
    output: z.array(cashSessionSchema),
    access: needs('sale.view'),
  },
  'sales:preview': {
    input: previewInputSchema,
    output: cartPreviewSchema,
    access: needs('pos.use'),
  },
  'sales:checkout': {
    input: checkoutInputSchema,
    output: saleDetailSchema,
    access: needs('pos.use'),
  },
  'sales:hold': {
    input: holdInputSchema,
    output: z.strictObject({ heldSaleId: z.number().int() }),
    access: needs('pos.use'),
  },
  'sales:held': {
    input: noInput,
    output: z.array(heldSaleSchema),
    access: needs('pos.use'),
  },
  'sales:resume': {
    input: saleIdInputSchema,
    output: heldCartSchema,
    access: needs('pos.use'),
  },
  'sales:discard': {
    input: saleIdInputSchema,
    output: z.null(),
    access: needs('pos.use'),
  },
  'sales:list': {
    input: saleListInputSchema,
    output: z.array(saleSummarySchema),
    access: needs('sale.view'),
  },
  'sales:get': {
    input: saleIdInputSchema,
    output: saleDetailSchema,
    access: needs('sale.view'),
  },
  'sales:cancel': {
    input: cancelSaleInputSchema,
    output: saleDetailSchema,
    access: needs('sale.cancel'),
  },
  'sales:return': {
    input: returnInputSchema,
    output: saleDetailSchema,
    access: needs('sale.return'),
  },
  'quotes:list': {
    input: quoteListInputSchema,
    output: z.array(quoteSummarySchema),
    access: needs('quote.manage'),
  },
  'quotes:get': {
    input: quoteIdInputSchema,
    output: quoteDetailSchema,
    access: needs('quote.manage'),
  },
  'quotes:save': {
    input: saveQuoteInputSchema,
    output: quoteDetailSchema,
    access: needs('quote.manage'),
  },
  'quotes:setStatus': {
    input: quoteStatusInputSchema,
    output: quoteDetailSchema,
    access: needs('quote.manage'),
  },
  'quotes:toCart': {
    input: quoteIdInputSchema,
    output: quoteCartSchema,
    access: needs('pos.use'),
  },
  'installments:list': {
    input: installmentListInputSchema,
    output: z.array(installmentRowSchema),
    access: needs('customer.manage'),
  },
  'deliveries:list': {
    input: deliveryListInputSchema,
    output: z.array(deliveryRowSchema),
    access: needs('delivery.manage'),
  },
  'deliveries:update': {
    input: deliveryUpdateInputSchema,
    output: z.null(),
    access: needs('delivery.manage'),
  },
  'documents:ticketText': {
    input: saleIdInputSchema,
    output: ticketTextSchema,
    access: SESSION,
  },
  'documents:printTicket': {
    input: saleIdInputSchema,
    output: printedSchema,
    access: SESSION,
  },
  'documents:saveSale': {
    input: documentInputSchema,
    output: savedSchema,
    access: SESSION,
  },
  'documents:saveQuote': {
    input: quoteDocumentInputSchema,
    output: savedSchema,
    access: needs('quote.manage'),
  },
  'sales:units': {
    input: saleUnitsInputSchema,
    output: z.array(saleUnitSchema),
    access: needs('pos.use'),
  },
} as const satisfies Record<IpcChannel, { input: z.ZodType; output: z.ZodType; access: IpcAccess }>;

export type IpcContract = typeof ipcContract;
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannel> = z.output<IpcContract[C]['output']>;
