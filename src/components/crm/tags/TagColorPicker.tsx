import { cn } from "@/lib/utils";
import { TAG_COLOR_PALETTE } from "@/types/tags";

interface TagColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

export function TagColorPicker({ value, onChange, disabled }: TagColorPickerProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {TAG_COLOR_PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          disabled={disabled}
          onClick={() => onChange(color)}
          className={cn(
            "h-6 w-6 rounded-full transition-all",
            value === color
              ? "ring-2 ring-offset-2 ring-offset-background ring-primary"
              : "hover:scale-110",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}
