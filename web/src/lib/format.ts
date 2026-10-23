// ₹1,499 (Indian digit grouping)
export const rupees = (amount: number): string => `₹${amount.toLocaleString("en-IN")}`;

// ₹1.2L, ₹45K: short enough for a chart axis
export const compactRupees = (amount: number): string =>
  `₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;

// "22 Oct 2026, 3:45 pm"
export const dateTime = (value: string): string =>
  new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
