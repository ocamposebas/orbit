export function formatMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amountMinor / 100).toFixed(2)}`;
  }
}

export function formatPortalDate(value: Date | number, options: Intl.DateTimeFormatOptions = {}) {
  const date = typeof value === "number" ? new Date(value * 1_000) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    timeZone: "UTC",
    ...options,
  }).format(date);
}

export function formatPortalDateTime(value: Date | number) {
  return formatPortalDate(value, { hour: "numeric", minute: "2-digit" });
}

export function formatTransferDate(value: Date | number) {
  return formatPortalDate(value, { month: "long", year: "numeric" });
}

export function transferArrivalTiming(value: Date | number, now = new Date()) {
  const arrival = typeof value === "number" ? new Date(value * 1_000) : value;
  const arrivalDay = Date.UTC(arrival.getUTCFullYear(), arrival.getUTCMonth(), arrival.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((arrivalDay - currentDay) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function relativeUpdatedAt(value: Date) {
  const seconds = Math.max(0, Math.round((Date.now() - value.getTime()) / 1_000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

export function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    SUCCEEDED: "Succeeded",
    PROCESSING: "Pending",
    REQUIRES_PAYMENT: "Pending",
    CREATED: "Pending",
    FAILED: "Failed",
    CANCELED: "Failed",
  };
  return labels[status] ?? status.toLowerCase().replaceAll("_", " ");
}

export function payoutStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pending",
    in_transit: "In transit",
    paid: "Paid",
    failed: "Failed",
    canceled: "Failed",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}
