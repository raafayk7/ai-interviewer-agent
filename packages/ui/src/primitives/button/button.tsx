import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@repo/ui/lib/cn";

/**
 * Button variants for Sift's interactive-element language.
 *
 * Token notes:
 * - All variants use `rounded-pill` (9999px) per ADR-025: pill radius signals interactive elements.
 * - Motion: `transition-colors duration-150 ease-out` (micro duration, DESIGN.md §6).
 * - Focus: keyboard-only ring (`focus-visible:*`) for the "Lucid" brand adjective (a11y).
 * - Disabled: `pointer-events-none opacity-50` — conventional; DESIGN.md has no specific disabled token.
 * - `icon` size is 36px (size-9), which falls below the 44px touch target recommendation.
 *   Always pair icon buttons with `aria-label` and ensure the surrounding layout provides
 *   adequate tap area (e.g., via padding on a parent element).
 * - `destructive` variant is for irreversible-action confirmations ONLY (delete modals,
 *   "Revoke link", "Remove member"). Never use for validation errors or outcome pills.
 *   See DESIGN.md §2 and ADR-025.
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "rounded-pill",
    "font-medium text-sm whitespace-nowrap",
    "transition-colors duration-150 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
  ],
  {
    variants: {
      variant: {
        /**
         * Primary: the main call-to-action (e.g., "+ New interview").
         * Deep background with high-contrast foreground.
         */
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        /**
         * Secondary: quieter action, same hierarchy family as primary but lower weight.
         */
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        /**
         * Ghost: transparent with a border — used for "Import CSV", "Back", and
         * other non-primary actions that sit beside a primary button.
         */
        ghost:
          "bg-transparent text-foreground border border-input hover:bg-card",
        /**
         * Destructive: reserved exclusively for irreversible actions.
         * See DESIGN.md §2 destructive token usage rules.
         */
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        /**
         * Link: inline navigational affordance styled as a button for a11y.
         */
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 text-sm",
        sm: "h-8 px-4 text-xs",
        lg: "h-11 px-7 text-base",
        /**
         * Icon: square 36px button for icon-only usage.
         * Below the 44px touch target minimum — always add `aria-label` on the button element.
         */
        icon: "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * When true, delegates rendering to its direct child via Radix Slot.
   * Use this to style a `<Link>` or any other element as a Button without
   * wrapping it in an extra DOM node.
   *
   * @example
   * <Button asChild variant="primary">
   *   <Link href="/interviews/new">New interview</Link>
   * </Button>
   */
  asChild?: boolean;
}

/**
 * Button — the first interactive primitive in Sift's design system.
 *
 * Forwards refs so parent composites, RHF field wrappers, and Radix trigger
 * components can attach imperative handles for focus management.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
