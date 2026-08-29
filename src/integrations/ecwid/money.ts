import { HttpError } from "@/sentinel/http";

function currencyExponent(currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new HttpError(422, "Ecwid returned an unsupported currency");
  }
}

function expandDecimal(value: string) {
  const match = value.match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new HttpError(422, "Ecwid returned an invalid order total");
  const digits = `${match[1]}${match[2] ?? ""}`;
  const decimalAt = match[1].length + Number(match[3] ?? 0);
  if (decimalAt <= 0) return `0.${"0".repeat(-decimalAt)}${digits}`;
  if (decimalAt >= digits.length) return `${digits}${"0".repeat(decimalAt - digits.length)}`;
  return `${digits.slice(0, decimalAt)}.${digits.slice(decimalAt)}`;
}

export function ecwidTotalToMinorUnits(total: number | string, currency: string) {
  const normalizedCurrency = currency.toUpperCase();
  const raw = typeof total === "number" ? (Number.isFinite(total) ? total.toString() : "") : total.trim();
  const expanded = expandDecimal(raw);
  const [whole, suppliedFraction = ""] = expanded.split(".");
  const exponent = currencyExponent(normalizedCurrency);
  if (suppliedFraction.length > exponent && /[1-9]/.test(suppliedFraction.slice(exponent))) {
    throw new HttpError(422, "Ecwid order total has too many decimal places for its currency");
  }
  const fraction = suppliedFraction.slice(0, exponent).padEnd(exponent, "0");
  const minor = BigInt(whole) * (BigInt(10) ** BigInt(exponent)) + BigInt(fraction || "0");
  if (minor <= BigInt(0) || minor > BigInt(2_147_483_647)) throw new HttpError(422, "Ecwid returned an invalid order total");
  return Number(minor);
}
