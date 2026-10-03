/*
 * Juros e multa por atraso de recebimentos (entradas recebidas depois do vencimento).
 * - Multa: percentual fixo sobre o valor, cobrado uma vez.
 * - Juros: percentual ao mês, pro rata die (mês de 30 dias), contado desde o vencimento.
 * - Carência: pagando até N dias depois do vencimento, nada é cobrado; passou disso,
 *   multa e juros contam desde o vencimento.
 * O valor extra soma no "recebido" (total recebido = valor + juros/multa).
 */

export interface LateChargeRules {
  /** Multa por atraso, em % do valor. */
  lateFee: number;
  /** Juros ao mês, em %. */
  monthlyInterest: number;
  /** Dias de carência. */
  graceDays: number;
}

export interface LateCharge {
  days: number;
  fee: number;
  interest: number;
  total: number;
}

const DAY = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (value: number) => Math.round(value * 100) / 100;

/** Dias corridos entre duas datas YYYY-MM-DD (sem fuso horário). */
export function daysBetween(from: string, to: string) {
  const parse = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / DAY);
}

/** Hoje (YYYY-MM-DD) no horário de Brasília. */
export function todayBR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const pct = (value: unknown, max: number) => Math.min(max, Math.max(0, Number(value) || 0));

/** Regras saneadas (percentuais entre 0 e 100, carência inteira entre 0 e 365). */
export function normalizeRules(value: Partial<LateChargeRules> | null | undefined): LateChargeRules {
  return {
    lateFee: pct(value?.lateFee, 100),
    monthlyInterest: pct(value?.monthlyInterest, 100),
    graceDays: Math.floor(pct(value?.graceDays, 365)),
  };
}

/** Juros/multa de um valor com vencimento `dueDate` pago em `paidAt`; null quando não há atraso cobrável. */
export function computeLateCharge(value: number, dueDate: string, paidAt: string, rules: LateChargeRules): LateCharge | null {
  if (!ISO_DATE.test(dueDate) || !ISO_DATE.test(paidAt) || !(value > 0)) return null;
  const days = daysBetween(dueDate, paidAt);
  if (days <= 0 || days <= rules.graceDays) return null;
  const fee = cents((value * rules.lateFee) / 100);
  const interest = cents((value * rules.monthlyInterest * days) / 100 / 30);
  if (fee + interest <= 0) return null;
  return { days, fee, interest, total: cents(fee + interest) };
}

/** Valor que conta como recebido/pago: o valor da movimentação mais juros/multa, se houver. */
export function entryTotal(entry: { value: number; lateCharge?: { total?: number } | null }) {
  return cents((entry.value || 0) + (entry.lateCharge?.total || 0));
}
