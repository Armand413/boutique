import { DEFAULT_CURRENCY, formatMoney, type CurrencyConfig } from '@shared/format/money';
import { cn } from '../../lib/cn';

interface MoneyProps {
  /** Montant entier dans la plus petite unité de la devise. */
  amount: number;
  currency?: CurrencyConfig;
  className?: string;
}

/** Affichage d'un montant avec chiffres tabulaires (A.2). */
export function Money({ amount, currency = DEFAULT_CURRENCY, className }: MoneyProps) {
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      {formatMoney(amount, currency)}
    </span>
  );
}
