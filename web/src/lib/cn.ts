// Joins class names, skipping the empty ones:
//   cn("rounded", busy && "opacity-50", className)
export const cn = (...classes: Array<string | false | null | undefined>): string => classes.filter(Boolean).join(" ");
