import { z } from "zod";

// Reports use Indian calendar days
export const REPORT_TIME_ZONE = "Asia/Kolkata";

// "2026-10-22": today's date in India (en-CA formats dates as YYYY-MM-DD)
export const todayInIndia = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE }).format(now);

// "2026-10-22" + 1 → "2026-10-23", done in UTC so no time zone or daylight saving gets in the way
export const addDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

const day = (label: string) => z.iso.date({ error: `${label} must be a date like 2026-10-22` });

// ?from=2026-10-01&to=2026-10-31 (both days included). Leave them out for the last 30 days.
const rangeFields = {
  from: day("from").optional(),
  to: day("to").optional()
};

// Fills in the defaults and checks the range makes sense.
// Generic over the query's other fields (<Q>): the result keeps them, and from/to become
// plain strings (no longer optional), so services can rely on both being there.
const withRange = (maxDays: number) => <Q extends { from?: string; to?: string }>(
  query: Q,
  ctx: z.RefinementCtx
): Q & { from: string; to: string } => {
  const to = query.to ?? todayInIndia();
  const from = query.from ?? addDays(to, -29);
  if (from > to) {
    ctx.addIssue({ code: "custom", message: "from can't be after to", path: ["from"] });
    return z.NEVER;
  }
  if (daysBetween(from, to) + 1 > maxDays) {
    ctx.addIssue({ code: "custom", message: `The range can be at most ${maxDays} days`, path: ["from"] });
    return z.NEVER;
  }
  return { ...query, from, to };
};

// GET /admin/reports/summary
export const summaryQuerySchema = z.object(rangeFields).transform(withRange(3660));

// GET /admin/reports/revenue?interval=week
// A daily series of 10 years would be 3,650 points: days are limited to 2 years
export const revenueQuerySchema = z
  .object({
    ...rangeFields,
    interval: z.enum(["day", "week", "month"], { error: "interval must be day, week or month" }).default("day")
  })
  .transform((query, ctx) => withRange(query.interval === "day" ? 731 : 3660)(query, ctx));

// GET /admin/reports/top-products?by=units&limit=10
export const topProductsQuerySchema = z
  .object({
    ...rangeFields,
    by: z.enum(["revenue", "units"], { error: "by must be revenue or units" }).default("revenue"),
    limit: z.coerce.number({ error: "limit must be a number" }).int().min(1).max(50, { error: "limit must be at most 50" }).default(10)
  })
  .transform(withRange(3660));

// GET /admin/reports/customers
export const customersQuerySchema = z
  .object({
    ...rangeFields,
    limit: z.coerce.number({ error: "limit must be a number" }).int().min(1).max(50, { error: "limit must be at most 50" }).default(10)
  })
  .transform(withRange(3660));

// The TypeScript types of the CHECKED data (after trimming, defaults, coercion...).
// Services use these, so the shape is written once: in the schema.
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type RevenueQuery = z.infer<typeof revenueQuerySchema>;
export type TopProductsQuery = z.infer<typeof topProductsQuerySchema>;
export type CustomersQuery = z.infer<typeof customersQuerySchema>;
