import { AppError } from "../middleware/errorHandler.js";

export const DEFAULT_CURRENCY = "INR";

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

const formatters = new Map<string, Intl.NumberFormat>();

export function isSupportedCurrency(code: string): boolean {
  return SUPPORTED_CURRENCIES.has(code);
}

export function normalizeCurrency(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_CURRENCY;

  if (typeof value !== "string") {
    throw new AppError("Currency must be a three-letter currency code.", 400);
  }

  const code = value.trim().toUpperCase();
  if (!isSupportedCurrency(code)) {
    throw new AppError(`"${value.trim().slice(0, 12)}" is not a supported currency code.`, 400);
  }

  return code;
}

export function formatMoney(amount: number, currency: string | null | undefined): string {
  const code = currency && isSupportedCurrency(currency) ? currency : DEFAULT_CURRENCY;

  let formatter = formatters.get(code);
  if (!formatter) {
    formatter = new Intl.NumberFormat(code === "INR" ? "en-IN" : "en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    formatters.set(code, formatter);
  }

  return formatter.format(amount);
}
