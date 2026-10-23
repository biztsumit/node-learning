import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-brand-fg shadow-sm hover:bg-brand-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-subtle",
  ghost: "text-fg hover:bg-subtle",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
  icon: "size-10",
};

// The classes alone, for things that LOOK like a button but are links:
//   <Link href="/products" className={buttonStyles({ size: "lg" })}>Shop now</Link>
export const buttonStyles = ({ variant = "primary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) =>
  cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean };

// type="button" by default: a plain <button> inside a form would SUBMIT it, a classic surprise
export function Button({ variant, size, loading = false, className, children, disabled, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonStyles({ variant, size, className })} {...props}>
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
