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

// Every API answer: { success, data } or { success: false, message, errors? }
export type ApiError = {
  success: false;
  message: string;
  errors?: Array<{ field: string; message: string }>;
};
