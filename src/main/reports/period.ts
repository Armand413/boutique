/** Jour local AAAA-MM-JJ d'une date (fuseau du poste). */
export function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

function startOfLocalDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function addDays(day: string, days: number): string {
  const date = startOfLocalDay(day);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

/**
 * Bornes UTC [début, fin[ d'une période de jours locaux inclus : les dates sont stockées en UTC,
 * la boutique raisonne en jours de son fuseau.
 */
export function utcBounds(period: { from: string; to: string }): [string, string] {
  return [
    startOfLocalDay(period.from).toISOString(),
    startOfLocalDay(addDays(period.to, 1)).toISOString(),
  ];
}

/** Nombre de jours de la période, bornes incluses. */
export function dayCount(period: { from: string; to: string }): number {
  const ms = startOfLocalDay(period.to).getTime() - startOfLocalDay(period.from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Aujourd'hui, semaine en cours (lundi) et mois en cours, en jours locaux. */
export function currentPeriods(now: Date): {
  today: { from: string; to: string };
  week: { from: string; to: string };
  month: { from: string; to: string };
  last30: { from: string; to: string };
  last7: { from: string; to: string };
} {
  const today = localDay(now);
  const weekday = (now.getDay() + 6) % 7;
  return {
    today: { from: today, to: today },
    week: { from: addDays(today, -weekday), to: today },
    month: { from: `${today.slice(0, 7)}-01`, to: today },
    last30: { from: addDays(today, -29), to: today },
    last7: { from: addDays(today, -6), to: today },
  };
}

/** Tous les jours de la période, pour un graphique sans trou. */
export function daysOf(period: { from: string; to: string }): string[] {
  const days: string[] = [];
  for (let day = period.from; day <= period.to; day = addDays(day, 1)) days.push(day);
  return days;
}
