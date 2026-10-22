// Turns a product name into a URL-friendly slug.
// "  Blue Cotton T-Shirt! " -> "blue-cotton-t-shirt"
export const slugify = (text: string): string => {
  const slug = text
    .normalize("NFKD")                // "é" -> "e" + accent mark
    .replace(/[̀-ͯ]/g, "")  // remove the accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")      // anything else becomes "-"
    .replace(/^-+|-+$/g, "")          // no "-" at the start or end
    .slice(0, 200);

  return slug || "product";
};
