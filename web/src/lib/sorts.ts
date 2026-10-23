// The catalog's sort options. In a plain module (not "use client") so both the server page
// and the client dropdown can read the list itself.
export const SORTS = [
  { value: "", label: "Recommended" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating_desc", label: "Top rated" },
] as const;
