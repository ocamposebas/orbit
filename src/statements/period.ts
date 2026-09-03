export type StatementPeriod = { start: Date; end: Date; year: number; month: number };

function zonedParts(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute"), second: part("second") };
}

/** Converts a civil time in an IANA zone to UTC, including DST boundaries. */
export function zonedDateToUtc(year: number, month: number, day: number, hour: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day, hour, 0, 0);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += target - represented;
  }
  return new Date(candidate);
}

export function calendarMonthPeriod(year: number, month: number, timeZone: string): StatementPeriod {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("Invalid statement month");
  const start = zonedDateToUtc(year, month, 1, 0, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = zonedDateToUtc(nextYear, nextMonth, 1, 0, timeZone);
  return { start, end, year, month };
}

export function previousCalendarMonth(now: Date, timeZone: string) {
  const local = zonedParts(now, timeZone);
  const year = local.month === 1 ? local.year - 1 : local.year;
  const month = local.month === 1 ? 12 : local.month - 1;
  return calendarMonthPeriod(year, month, timeZone);
}

export function monthlyGenerationIsDue(now: Date, timeZone: string, day: number, hour: number) {
  const local = zonedParts(now, timeZone);
  return local.day > day || (local.day === day && local.hour >= hour);
}
