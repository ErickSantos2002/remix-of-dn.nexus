import { ContactTagBadge } from "./ContactTagBadge";
import type { ContactTag } from "@/types/tags";

interface ContactTagListProps {
  tags: ContactTag[];
  maxVisible?: number;
  onTagClick?: (tag: ContactTag) => void;
  size?: "sm" | "md";
}

export function ContactTagList({
  tags,
  maxVisible = 3,
  onTagClick,
  size = "sm"
}: ContactTagListProps) {
  if (!tags || tags.length === 0) return null;

  const visibleTags = tags.slice(0, maxVisible);
  const hiddenCount = tags.length - maxVisible;

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {visibleTags.map((tag, idx) => (
        <ContactTagBadge
          key={`${tag.name}-${idx}`}
          tag={tag}
          size={size}
          className={onTagClick ? "cursor-pointer" : undefined}
        />
      ))}
      {hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
