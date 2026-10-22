// The emails a customer gets about their order. Each one has an HTML and a plain-text
// version (some email apps show only text, and spam filters like having both).
import { env } from "../config/env.ts";
import type { CancelReason, Customer, Order, OrderItem, ShippingAddress } from "../services/order.services.ts";
import type { Email } from "./transport.ts";

// The emails need the customer, which getOrderById includes when asked as an admin (no userId)
export type OrderForEmail = Order & { customer: Customer };

// Anything that came from a user (names, product names, addresses) goes through this.
// An email is HTML: an unescaped product name like "<img src=x onerror=...>" would become markup.
const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);

const rupees = (amount: number): string => `₹${Number(amount).toLocaleString("en-IN")}`;
// A Date from the database, or its text form (as it arrives in JSON)
const dateTime = (value: Date | string): string =>
  new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

// Record<CancelReason, string>: every way an order can be cancelled has an explanation
const CANCEL_REASONS: Record<CancelReason, string> = {
  customer: "You cancelled this order.",
  admin: "We're sorry: we had to cancel this order.",
  payment_timeout: "We didn't receive payment in time, so the order was cancelled and the items were released."
};

type EmailContent = { subject: string; heading: string; lines: Array<string | false | null> };

// What each email says. `order` is the full order from getOrderById (with customer).
const CONTENT = {
  placed: (order) => ({
    subject: `We've got your order ${order.orderNumber}`,
    heading: "Thanks for your order!",
    lines: [
      `Your order <strong>${order.orderNumber}</strong> is waiting for payment.`,
      order.expiresAt && `Please pay by <strong>${dateTime(order.expiresAt)}</strong>, or it will be cancelled automatically.`
    ]
  }),
  paid: (order) => ({
    subject: `Payment received for ${order.orderNumber}`,
    heading: "Payment received",
    lines: [`We've received your payment of <strong>${rupees(order.totalAmount)}</strong>. We'll let you know when it ships.`]
  }),
  shipped: (order) => ({
    subject: `Your order ${order.orderNumber} is on its way`,
    heading: "It's on its way!",
    lines: [`Your order <strong>${order.orderNumber}</strong> has been shipped.`]
  }),
  delivered: (order) => ({
    subject: `Delivered: ${order.orderNumber}`,
    heading: "Delivered",
    lines: [`Your order <strong>${order.orderNumber}</strong> has been delivered. We hope you enjoy it!`, "You can now review the products you bought."]
  }),
  cancelled: (order) => ({
    subject: `Order ${order.orderNumber} cancelled`,
    heading: "Order cancelled",
    lines: [
      (order.cancelReason && CANCEL_REASONS[order.cancelReason]) ?? "This order has been cancelled.",
      order.refund && `Your payment of <strong>${rupees(order.refund.amount)}</strong> is being refunded to your original payment method.`
    ]
  }),
  refunded: (order) => ({
    subject: `Refund processed for ${order.orderNumber}`,
    heading: "Your refund is on its way",
    lines: [
      `We've refunded <strong>${rupees(order.refund?.amount ?? order.totalAmount)}</strong> for order ${order.orderNumber}.`,
      "Banks usually take 5-7 working days to show it in your account."
    ]
  })
} satisfies Record<string, (order: OrderForEmail) => EmailContent>;

// "placed" | "paid" | "shipped" | "delivered" | "cancelled" | "refunded": the keys of CONTENT
export type OrderEmailType = keyof typeof CONTENT;
export const ORDER_EMAIL_TYPES = Object.keys(CONTENT) as OrderEmailType[];

// "T-Shirt" or "T-Shirt (Size: M)"
const itemName = (item: OrderItem): string => (item.optionsLabel ? `${item.productName} (${item.optionsLabel})` : item.productName);

// "Coupon WELCOME10" and the amount saved, only when the order had a discount
const discountLine = (order: Order): [string, string] | null =>
  order.discountAmount > 0 ? [`Coupon ${order.couponCode}`, `-${rupees(order.discountAmount)}`] : null;

const itemsTable = (order: Order, discount = discountLine(order)): string => `
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
    ${order.items.map((item) => `
      <tr>
        <td style="padding:6px 0;border-bottom:1px solid #eee">${escapeHtml(itemName(item))} × ${item.quantity}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${rupees(item.lineTotal)}</td>
      </tr>`).join("")}
    ${discount ? `
      <tr>
        <td style="padding:6px 0;color:#1a7f37">${escapeHtml(discount[0])}</td>
        <td style="padding:6px 0;color:#1a7f37;text-align:right">${discount[1]}</td>
      </tr>` : ""}
    <tr>
      <td style="padding:8px 0;font-weight:bold">Total</td>
      <td style="padding:8px 0;font-weight:bold;text-align:right">${rupees(order.totalAmount)}</td>
    </tr>
  </table>`;

const addressBlock = (address: ShippingAddress | null | undefined): string =>
  address
    ? `<p style="font-size:13px;color:#555">Shipping to:<br>${[address.fullName, address.line1, address.line2, `${address.city} ${address.postalCode}`]
        .filter(Boolean).map(escapeHtml).join("<br>")}</p>`
    : "";

// Builds { to, toName, subject, html, text } for one order email
export const buildOrderEmail = (type: OrderEmailType, order: OrderForEmail): Email => {
  const content = CONTENT[type];
  if (!content) {
    throw new Error(`Unknown order email type "${type}"`);
  }
  const { subject, heading, lines } = content(order);
  // A type guard: filter(Boolean) drops the false/null lines, but only "line is string"
  // tells TypeScript that what's left are all strings
  const paragraphs = lines.filter((line): line is string => Boolean(line));
  const discount = discountLine(order);
  const name = order.customer.name;

  // Only our own fixed text and escaped values go into the HTML; order numbers and amounts
  // are generated by us, everything typed by a person is escaped.
  const html = `<!doctype html>
<html><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#222">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;padding:24px">
    <p style="color:#888;font-size:13px;margin:0 0 8px">${escapeHtml(env.EMAIL_FROM_NAME)}</p>
    <h1 style="font-size:22px;margin:0 0 16px">${heading}</h1>
    <p>Hi ${escapeHtml(name)},</p>
    ${paragraphs.map((p) => `<p>${p}</p>`).join("\n    ")}
    ${itemsTable(order, discount)}
    ${addressBlock(order.shippingAddress)}
    <p style="font-size:12px;color:#999;margin-top:24px">Order ${order.orderNumber} · placed ${dateTime(order.createdAt)}</p>
  </div>
</body></html>`;

  const text = [
    `Hi ${name},`,
    "",
    ...paragraphs.map((p) => p.replace(/<[^>]+>/g, "")),
    "",
    ...order.items.map((item) => `- ${itemName(item)} x ${item.quantity}: ${rupees(item.lineTotal)}`),
    ...(discount ? [discount.join(": ")] : []),
    `Total: ${rupees(order.totalAmount)}`,
    "",
    `Order ${order.orderNumber}`
  ].join("\n");

  return { to: order.customer.email, toName: name, subject, html, text };
};
