"use client";

import { useEffect, useRef, useState } from "react";
import { compactRupees, rupees } from "@/lib/format";
import type { RevenuePoint, RevenueSeries } from "@/lib/types";

// A column chart of revenue per day/week/month, drawn as plain SVG (no chart library: it's
// one series of columns, and every piece below is a few lines).
//
// Design rules it follows (they keep a chart easy to read):
// - One series = one colour (the --chart token: checked for contrast and colour-blind
//   safety, with its own dark-mode step), and no legend box (the heading already says what it shows)
// - Thin columns (at most 24px) with a 2px gap between neighbours, rounded only at the top
// - Hairline gridlines; only the highest column gets a value label (not every column)
// - Hover OR keyboard focus shows the exact numbers, and a table view has them all, so
//   nothing depends on hovering or on seeing colour

const PLOT_HEIGHT = 200;
const MARGIN = { top: 24, right: 8, bottom: 28, left: 56 };

// "Nice" axis steps: 1, 2, 2.5 or 5 × a power of ten (₹0 / ₹2.5K / ₹5K..., never ₹3,127)
const niceStep = (roughStep: number): number => {
  const power = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
};

// The API sends periods as "2026-10-22". Read them as UTC so no time zone shifts the day.
const asDate = (period: string) => new Date(`${period}T00:00:00Z`);

export const periodLabel = (period: string, interval: RevenueSeries["interval"], long = false): string => {
  const date = asDate(period);
  if (interval === "month") {
    return date.toLocaleDateString("en-IN", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  }
  const day = date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(long && interval === "day" && { weekday: "short" }),
    timeZone: "UTC",
  });
  return interval === "week" && long ? `Week of ${day}` : day;
};

export function RevenueChart({ series, faded }: { series: RevenueSeries; faded: boolean }) {
  // SVG text doesn't scale nicely with viewBox, so measure the real width and draw to it
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const { points, interval } = series;
  const max = Math.max(0, ...points.map((p) => p.revenue));
  const step = niceStep(Math.max(max, 1000) / 4);
  const top = Math.ceil(Math.max(max, 1) / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 100);
  const band = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.max(Math.min(24, band - 2), 1);
  const y = (value: number) => MARGIN.top + PLOT_HEIGHT - (value / top) * PLOT_HEIGHT;
  const baseline = y(0);
  const center = (i: number) => MARGIN.left + band * i + band / 2;

  // Label about 6 dates along the bottom, evenly spaced
  const labelEvery = Math.ceil(points.length / Math.max(Math.floor(plotWidth / 90), 1));
  const peak = max > 0 ? points.findIndex((p) => p.revenue === max) : -1;
  const shown: RevenuePoint | undefined = active === null ? undefined : points[active];

  return (
    <div className={`flex flex-col gap-3 transition-opacity ${faded ? "opacity-50" : ""}`}>
      <div ref={boxRef} className="relative">
        <svg width={width} height={MARGIN.top + PLOT_HEIGHT + MARGIN.bottom} className="block" aria-label="Revenue chart">
          {/* Gridlines and the ₹ scale */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(tick)} y2={y(tick)} strokeWidth={1} className={tick === 0 ? "stroke-line-strong" : "stroke-line"} shapeRendering="crispEdges" />
              <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {compactRupees(tick)}
              </text>
            </g>
          ))}

          {points.map((point, i) => {
            const x = center(i) - barWidth / 2;
            const height = baseline - y(point.revenue);
            const r = Math.min(4, barWidth / 2, height);
            return (
              <g key={point.period}>
                {/* The column: rounded at the data end, square on the baseline */}
                {height > 0 && (
                  <path
                    d={`M${x},${baseline} V${baseline - height + r} Q${x},${baseline - height} ${x + r},${baseline - height} H${x + barWidth - r} Q${x + barWidth},${baseline - height} ${x + barWidth},${baseline - height + r} V${baseline} Z`}
                    className="fill-chart"
                    opacity={active === null || active === i ? 1 : 0.55}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={center(i)} y={baseline + 18} textAnchor="middle" className="fill-muted text-[11px]">
                    {periodLabel(point.period, interval)}
                  </text>
                )}
                {/* The hover/focus target: the whole column of space, much bigger than the bar */}
                <rect
                  x={MARGIN.left + band * i}
                  y={MARGIN.top}
                  width={band}
                  height={PLOT_HEIGHT}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${periodLabel(point.period, interval, true)}: ${rupees(point.revenue)}, ${point.orders} orders`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none"
                />
              </g>
            );
          })}

          {/* One direct label, on the best period. The rest are in the tooltip and the table. */}
          {peak >= 0 && active === null && (
            <text x={center(peak)} y={y(max) - 6} textAnchor="middle" className="fill-fg text-[11px] font-medium">
              {compactRupees(max)}
            </text>
          )}
        </svg>

        {shown && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-pop"
            style={{ left: Math.min(Math.max(center(active), 70), width - 70), top: y(shown.revenue) - 8 }}
          >
            <div className="font-semibold">{rupees(shown.revenue)}</div>
            <div className="whitespace-nowrap text-xs text-muted">
              {periodLabel(shown.period, interval, true)} · {shown.orders} order{shown.orders === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>

      {/* The same numbers as a table: for screen readers, and anyone who wants exact values */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">Show as table</summary>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <table className="w-full tabular-nums">
            <thead className="text-left text-muted">
              <tr><th className="py-1 font-medium">Period</th><th className="py-1 text-right font-medium">Orders</th><th className="py-1 text-right font-medium">Units</th><th className="py-1 text-right font-medium">Revenue</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {points.map((p) => (
                <tr key={p.period}>
                  <td className="py-1">{periodLabel(p.period, interval, true)}</td>
                  <td className="py-1 text-right">{p.orders}</td>
                  <td className="py-1 text-right">{p.unitsSold}</td>
                  <td className="py-1 text-right">{rupees(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
