export type MoneyCentavos = number;

export function assertCentavosInt(v: unknown, fieldName = "amount_centavos"): asserts v is MoneyCentavos {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.floor(v) !== v) {
    throw new Error(`${fieldName} must be an integer (centavos)`);
  }
}
