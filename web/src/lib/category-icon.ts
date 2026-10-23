import { Footprints, Gem, Headphones, Lamp, type LucideIcon, Shirt, Sofa, Sparkles, Tag, UtensilsCrossed } from "lucide-react";

// Categories are created by admins with any name, and have no picture. This picks a fitting
// icon from words in the name, with a plain tag for anything unknown.
const RULES: Array<[RegExp, LucideIcon]> = [
  [/shoe|foot|sneaker|sandal/i, Footprints],
  [/cloth|shirt|wear|apparel|tee/i, Shirt],
  [/fashion|style|beauty/i, Sparkles],
  [/electr|tech|gadget|audio|phone/i, Headphones],
  [/kitchen|dining|cook/i, UtensilsCrossed],
  [/home|furniture|decor|living/i, Sofa],
  [/light|lamp/i, Lamp],
  [/jewel|accessor|watch/i, Gem],
];

export const categoryIcon = (name: string): LucideIcon => RULES.find(([pattern]) => pattern.test(name))?.[1] ?? Tag;
