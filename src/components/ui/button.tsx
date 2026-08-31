import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-[16px] font-semibold text-white bg-[linear-gradient(135deg,var(--dn-blue),var(--dn-blue-deep))] shadow-brand hover:-translate-y-0.5 hover:brightness-110 hover:shadow-brand-hover active:translate-y-0",
        destructive:
          "rounded-[16px] font-semibold text-white bg-[linear-gradient(135deg,var(--dn-red),var(--dn-red-deep))] shadow-danger hover:-translate-y-0.5 hover:brightness-110",
        glass:
          "rounded-[16px] font-semibold text-foreground bg-white/[0.04] border border-primary/35 backdrop-blur-[12px] hover:bg-white/[0.07] hover:border-primary/60",
        // Secundario padrao: hairline, texto normal. NAO e o ghost mono do DS —
        // 396 botoes usam esta variante, muitos com rotulo longo, e o mono
        // uppercase (tracking 0.16em) truncava rotulos e destoava dos ghost.
        outline:
          "rounded-[16px] border border-[var(--line-strong)] bg-transparent text-foreground hover:border-[var(--accent-ink)] hover:bg-[var(--surface-hover)]",
        // Ghost do V3: mono uppercase, para toolbar, cancelar e acao de linha.
        // Aplicar so onde o rotulo e curto.
        mono:
          "rounded-[16px] font-mono text-xs font-bold uppercase tracking-[0.16em] border border-[var(--line-strong)] bg-transparent text-foreground hover:border-[var(--accent-ink)] hover:-translate-y-0.5",
        secondary:
          "rounded-[16px] bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "rounded-[12px] hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-3",
        sm: "h-9 px-4 text-[0.8rem]",
        lg: "h-12 px-8",
        icon: "h-8 w-8 rounded-[8px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
