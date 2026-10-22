// ₹1,499 (Indian digit grouping)
export const rupees = (amount: number): string => `₹${amount.toLocaleString("en-IN")}`;
