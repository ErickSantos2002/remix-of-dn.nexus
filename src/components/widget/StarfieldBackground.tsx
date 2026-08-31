import { cn } from "@/lib/utils";

interface StarfieldBackgroundProps {
  children: React.ReactNode;
  className?: string;
}

export function StarfieldBackground({ children, className }: StarfieldBackgroundProps) {
  return (
    <div className={cn("starfield-bg starfield-particles", className)}>
      {children}
    </div>
  );
}
