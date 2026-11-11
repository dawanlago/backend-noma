/*
 * Parcelamento de uma movimentação (ex.: compra no cartão em 3x, venda em boletos).
 * O valor principal e os juros do parcelamento são divididos em parcelas mensais;
 * os centavos que sobram ficam na primeira parcela.
 */

export interface InstallmentPart {
  number: number;
  date: string;
  value: number;
  interest: number;
}

/** Soma `months` meses a uma data YYYY-MM-DD, mantendo o dia (ou o último dia do mês, se ele não existir). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function splitCents(total: number, count: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  return Array.from({ length: count }, (_, index) => (base + (index === 0 ? cents - base * count : 0)) / 100);
}

/** Divide `value` (principal) e `interest` (juros totais) em `count` parcelas mensais a partir de `firstDate`. */
export function splitInstallments(value: number, interest: number, count: number, firstDate: string): InstallmentPart[] {
  const n = Math.min(60, Math.max(1, Math.floor(count)));
  const values = splitCents(Math.max(0, value), n);
  const interests = splitCents(Math.max(0, interest), n);
  return values.map((part, index) => ({
    number: index + 1,
    date: addMonths(firstDate, index),
    value: part,
    interest: interests[index],
  }));
}

/** Juros totais de um parcelamento com taxa mensal (tabela Price: parcelas iguais). */
export function priceInterest(value: number, monthlyRate: number, count: number): number {
  const i = monthlyRate / 100;
  if (!(value > 0) || !(i > 0) || count < 1) return 0;
  const payment = (value * i) / (1 - Math.pow(1 + i, -count));
  return Math.round((payment * count - value) * 100) / 100;
}
