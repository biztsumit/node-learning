// The shapes the API sends back (see the API's /docs for the full description)

export type Category = { id: string; name: string };

export type Variant = {
  id: string;
  options: Record<string, string>;
  label: string;            // "Size: M, Colour: Blue" ("" for a product without options)
  sku: string | null;
  price: number;            // whole rupees
  stock: number;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;            // the lowest variant price
  stock: number;            // total across variants
  variantCount: number;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  rating: { average: number; count: number };
  category: Category | null;
};

export type ProductWithVariants = Product & { variants: Variant[] };

export type Pagination = {
  page?: number;
  limit: number;
  total?: number;
  totalPages?: number;
  nextCursor: string | null;
};

export type CartItem = {
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  options: Record<string, string>;
  optionsLabel: string;
  price: number;
  imageUrl: string | null;
  stock: number;
  quantity: number;
  lineTotal: number;
};

export type Cart = {
  items: CartItem[];
  totalQuantity: number;
  subtotal: number;
  coupon: { code: string; description: string; discount: number } | null;
  discount: number;
  total: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
};

export type Address = {
  id: string;
  label: string | null;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
};

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export type OrderItem = {
  productId: string | null;
  variantId: string | null;
  productName: string;
  options: Record<string, string>;
  optionsLabel: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type Order = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  subtotalAmount: number;
  discountAmount: number;
  couponCode: string | null;
  totalAmount: number;
  createdAt: string;
  expiresAt: string | null;          // pending orders: pay before this, or they're cancelled
  cancelReason: "customer" | "admin" | "payment_timeout" | null;
  refund: { status: string; amount: number; requestedAt: string } | null;
  shippingAddress: Omit<Address, "id" | "label" | "isDefault">;
  items: OrderItem[];
};

export type OrderSummary = Pick<Order, "id" | "orderNumber" | "status" | "totalAmount" | "createdAt"> & { itemCount: number };

// ---------- Reviews and wishlist ----------

export type Review = {
  id: string;
  rating: number;                    // 1-5
  comment: string;
  reviewer: string;                  // "Riya S.": the API never shows full names publicly
  createdAt: string;
};

export type ReviewPage = {
  summary: { average: number; count: number; breakdown: Record<"1" | "2" | "3" | "4" | "5", number> };
  reviews: Review[];
};

export type WishlistItem = {
  productId: string;
  slug: string;
  name: string;
  price: number;
  inStock: boolean;
  thumbnailUrl: string | null;
  rating: { average: number; count: number };
  addedAt: string;
};

// ---------- Admin panel ----------

export type Customer = { id: string; name: string; email: string };

// The admin order endpoints add who placed the order
export type AdminOrder = Order & { customer: Customer };
export type AdminOrderSummary = OrderSummary & { customer: Customer };

export type Coupon = {
  id: string;
  code: string;
  description: string;
  discountType: "percent" | "fixed";
  discountValue: number;             // percent: 1-100; fixed: rupees off
  minOrderAmount: number;
  maxDiscount: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  usageLimit: number | null;         // null = unlimited
  perUserLimit: number | null;
  timesUsed: number;
  isActive: boolean;
};

// A number compared with the same-length period before it
export type Metric = { value: number; previous: number; changePercent: number | null };

export type SalesSummary = {
  from: string;
  to: string;
  revenue: Metric;
  orders: Metric;
  unitsSold: Metric;
  discounts: Metric;
  averageOrderValue: Metric;
  dataAsOf: string | null;
};

export type RevenuePoint = { period: string; revenue: number; orders: number; unitsSold: number };

export type RevenueSeries = {
  from: string;
  to: string;
  interval: "day" | "week" | "month";
  points: RevenuePoint[];
};

export type TopProduct = {
  rank: number;
  productId: string | null;          // null: the product was deleted since
  name: string;
  unitsSold: number;
  revenue: number;
  revenueSharePercent: number | null;
  orders: number;
};

// What POST /orders/:id/payment returns: everything Razorpay Checkout needs
export type PaymentDetails = {
  orderId: string;
  keyId: string;
  razorpayOrderId: string;
  amount: number;                    // paise
  currency: string;
  prefill: { name: string; email: string; contact: string | null };
};

// Every API answer: { success, data } or { success: false, message, errors? }
export type ApiError = {
  success: false;
  message: string;
  errors?: Array<{ field: string; message: string }>;
};
