/**
 * Chave para comparar telefones vindos de lugares diferentes (cadastro com máscara,
 * WhatsApp com DDI, números antigos sem o 9). Brasil: DDD + últimos 8 dígitos.
 * Outros países: os últimos 10 dígitos.
 */
export function phoneKey(value: string): string {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  // Celular brasileiro com o 9 na frente (DDD + 9 + 8 dígitos).
  if (digits.length === 11 && digits[2] === "9") return digits.slice(0, 2) + digits.slice(3);
  if (digits.length === 10) return digits;
  return digits.length >= 8 ? digits.slice(-10) : "";
}

export function samePhone(a: string, b: string): boolean {
  const keyA = phoneKey(a);
  return Boolean(keyA) && keyA === phoneKey(b);
}
