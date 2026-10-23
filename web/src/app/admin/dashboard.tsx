"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { dateTime, rupees } from "@/lib/format";
import type { Metric, RevenueSeries, SalesSummary, TopProduct } from "@/lib/types";
import { RevenueChart } from "./revenue-chart";
import { errorText, useAdminData } from "./use-admin-data";

// Last 7 / 30 / 90 days. Long ranges are grouped by week, so the chart stays readable.
const RANGES = [
  { days: 7, interval: "day" },
  { days: 30, interval: "day" },
  { days: 90, interval: "week" },
] as const;

// The API's reports count Indian calendar days, so "today" here must be today in India too
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const daysBefore = (day: string, days: number) => {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export function Dashboard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const to = todayInIndia();
  const query = `from=${daysBefore(to, range.days - 1)}&to=${to}`;

  // Three reports, fetched side by side. The same date range scopes all of them, so their
  // numbers always agree with each other.
  const summary = useAdminData<{ data: SalesSummary }>(`/admin/reports/summary?${query}`);
  const revenue = useAdminData<{ data: RevenueSeries }>(`/admin/reports/revenue?${query}&interval=${range.interval}`);
  const top = useAdminData<{ data: { products: TopProduct[] } }>(`/admin/reports/top-products?${query}&limit=5`);

  // Revenue numbers come from a summary table the API rebuilds every few minutes.
  // This asks it to rebuild now, then loads everything again.
  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await api("/admin/reports/refresh", { method: "POST" });
      summary.reload();
      revenue.reload();
      top.reload();
    } catch (err) {
      setRefreshError(errorText(err));
    } finally {
      setRefreshing(false);
    }
  };

  const error = summary.error ?? revenue.error ?? top.error;
  const s = summary.data?.data;
  const vs = `vs previous ${range.days} days`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Dashboard</h1>
        {/* The one filter row: it scopes everything below it */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div role="group" aria-label="Date range" className="flex rounded-lg border border-line-strong bg-surface p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                aria-pressed={r === range}
                onClick={() => setRange(r)}
                className="rounded px-3 py-1 text-muted hover:text-fg aria-pressed:bg-brand aria-pressed:text-brand-fg"
              >
                {r.days} days
              </button>
            ))}
          </div>
          <button type="button" onClick={refresh} disabled={refreshing} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 hover:bg-subtle disabled:opacity-50">
            {refreshing ? "Refreshing…" : "Refresh numbers"}
          </button>
        </div>
      </div>

      {(error || refreshError) && <p role="alert" className="text-danger">{refreshError ?? error}</p>}

      {!s ? (
        !error && <div className="h-24 animate-pulse rounded-lg bg-subtle" />
      ) : (
        <div className={`grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-4 ${summary.loading ? "opacity-50" : ""}`}>
          <StatTile label="Revenue" value={rupees(s.revenue.value)} metric={s.revenue} vs={vs} />
          <StatTile label="Orders" value={s.orders.value.toLocaleString("en-IN")} metric={s.orders} vs={vs} />
          <StatTile label="Average order" value={rupees(s.averageOrderValue.value)} metric={s.averageOrderValue} vs={vs} />
          <StatTile label="Units sold" value={s.unitsSold.value.toLocaleString("en-IN")} metric={s.unitsSold} vs={vs} />
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface shadow-card p-4">
        <div>
          <h2 className="font-medium">Revenue {range.interval === "week" ? "per week" : "per day"}</h2>
          <p className="text-sm text-muted">Paid, shipped and delivered orders, by the day they were placed (Indian time)</p>
        </div>
        {revenue.data ? (
          <RevenueChart series={revenue.data.data} faded={revenue.loading} />
        ) : (
          !revenue.error && <div className="h-60 animate-pulse rounded bg-subtle" />
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface shadow-card p-4">
        <h2 className="font-medium">Best sellers</h2>
        {top.data && <TopProducts products={top.data.data.products} faded={top.loading} />}
      </section>

      {s?.dataAsOf && <p className="text-xs text-muted">Revenue figures as of {dateTime(s.dataAsOf)}</p>}
    </div>
  );
}

// A headline number, with how it changed against the previous period of the same length.
// The change has an arrow AND words, so it doesn't rely on red/green alone.
function StatTile({ label, value, metric, vs }: { label: string; value: string; metric: Metric; vs: string }) {
  const change = metric.changePercent;
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface shadow-card p-4">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-muted">
        {/* null: the previous period had nothing, so a % change would be meaningless */}
        {change === null ? (
          `No sales in the ${vs.replace("vs ", "")}`
        ) : (
          <>
            <span className={`font-medium ${change > 0 ? "text-success" : change < 0 ? "text-danger" : "text-muted"}`}>
              {change > 0 ? "▲" : change < 0 ? "▼" : "■"} {Math.abs(change)}%
            </span>{" "}
            {vs}
          </>
        )}
      </span>
    </div>
  );
}

function TopProducts({ products, faded }: { products: TopProduct[]; faded: boolean }) {
  if (products.length === 0) {
    return <p className="text-sm text-muted">No sales in this period yet.</p>;
  }
  return (
    <table className={`w-full text-sm transition-opacity ${faded ? "opacity-50" : ""}`}>
      <thead className="text-left text-muted">
        <tr>
          <th className="py-1 font-medium">#</th>
          <th className="py-1 font-medium">Product</th>
          <th className="py-1 text-right font-medium">Units</th>
          <th className="py-1 text-right font-medium">Revenue</th>
          <th className="hidden py-1 pl-4 font-medium sm:table-cell">Share of revenue</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line tabular-nums">
        {products.map((p) => (
          <tr key={`${p.rank}-${p.productId ?? p.name}`}>
            <td className="py-2 text-muted">{p.rank}</td>
            <td className="py-2">
              {/* A deleted product has no id any more: just its name, as it was sold */}
              {p.productId ? <Link href={`/admin/products/${p.productId}`} className="hover:underline">{p.name}</Link> : <span className="text-muted">{p.name} (deleted)</span>}
            </td>
            <td className="py-2 text-right">{p.unitsSold}</td>
            <td className="py-2 text-right">{rupees(p.revenue)}</td>
            <td className="hidden py-2 pl-4 sm:table-cell">
              {/* A small meter: a lighter track of the same blue, filled to the share */}
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-chart-track">
                  <span className="block h-full rounded-full bg-chart" style={{ width: `${p.revenueSharePercent ?? 0}%` }} />
                </span>
                <span className="text-muted">{p.revenueSharePercent ?? 0}%</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
