import { randomInt } from "node:crypto";

// No 0/O, 1/I/L or U: characters people mix up when reading or saying them
export const ORDER_NUMBER_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 6;   // 29^6 ≈ 594 million possible numbers

export const ORDER_NUMBER_PATTERN = new RegExp(`^ORD-[${ORDER_NUMBER_ALPHABET}]{${LENGTH}}$`);

// Wrapped in an object so tests can swap `next` to force a collision
export const orderNumbers = {
  // randomInt is uniform: every character is equally likely (unlike Math.random() * 29)
  next: () =>
    "ORD-" + Array.from({ length: LENGTH }, () => ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)]).join("")
};
