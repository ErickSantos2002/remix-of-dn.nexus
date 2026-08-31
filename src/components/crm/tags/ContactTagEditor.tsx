import { useState, useRef, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ContactTagBadge } from "./ContactTagBadge";
import { TagColorPicker } from "./TagColorPicker";
import { getDefaultTagColor, TAG_COLOR_PALETTE } from "@/types/tags";
import type { ContactTag } from "@/types/tags";

interface ContactTagEditorProps {
  tags: ContactTag[];
  onChange: (tags: ContactTag[]) => void;
  workspaceTags?: ContactTag[];
  disabled?: boolean;
  placeholder?: string;
}

// Validate tag name: min 3 chars, only letters, numbers, spaces and hyphens
const validateTagName = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed.length < 3) {
    return "Minimo 3 caracteres";
  }
  // Allow letters (including accented), numbers, spaces and hyphens
  const validPattern = /^[\p{L}\p{N}\s\-]+$/u;
  if (!validPattern.test(trimmed)) {
    return "Apenas letras, numeros e hifens";
  }
  return null;
};

export function ContactTagEditor({
  tags,
  onChange,
  workspaceTags = [],
  disabled,
  placeholder = "Adicionar tag...",
}: ContactTagEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(TAG_COLOR_PALETTE[0]);
  const [suggestions, setSuggestions] = useState<ContactTag[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Filter suggestions based on input
  useEffect(() => {
    if (!newTagName.trim()) {
      setSuggestions([]);
      return;
    }

    const search = newTagName.toLowerCase();
    const existingNames = new Set(tags.map((t) => t.name.toLowerCase()));

    const filtered = workspaceTags.filter(
      (tag) =>
        tag.name.toLowerCase().includes(search) &&
        !existingNames.has(tag.name.toLowerCase())
    );

    setSuggestions(filtered.slice(0, 5));
  }, [newTagName, workspaceTags, tags]);

  // Update color based on tag name for consistency
  useEffect(() => {
    if (newTagName.trim()) {
      // Check if there's a matching workspace tag with a color
      const existing = workspaceTags.find(
        (t) => t.name.toLowerCase() === newTagName.toLowerCase()
      );
      if (existing) {
        setNewTagColor(existing.color);
      } else {
        setNewTagColor(getDefaultTagColor(newTagName));
      }
    }
  }, [newTagName, workspaceTags]);

  // Validate tag name on change
  useEffect(() => {
    if (!newTagName.trim()) {
      setValidationError(null);
      return;
    }
    // Skip validation if tag already exists in workspace (allow selecting existing)
    const existsInWorkspace = workspaceTags.some(
      (t) => t.name.toLowerCase() === newTagName.trim().toLowerCase()
    );
    if (existsInWorkspace) {
      setValidationError(null);
      return;
    }
    setValidationError(validateTagName(newTagName));
  }, [newTagName, workspaceTags]);

  const handleAddTag = () => {
    const trimmedName = newTagName.trim();
    if (!trimmedName) return;

    // Check for duplicate in current contact
    if (tags.some((t) => t.name.toLowerCase() === trimmedName.toLowerCase())) {
      return;
    }

    // Check if tag exists in workspace - reuse it with its color
    const existingWorkspaceTag = workspaceTags.find(
      (t) => t.name.toLowerCase() === trimmedName.toLowerCase()
    );

    // Validate only if creating new tag (not reusing existing)
    if (!existingWorkspaceTag) {
      const error = validateTagName(trimmedName);
      if (error) {
        setValidationError(error);
        return;
      }
    }

    const tagToAdd: ContactTag = existingWorkspaceTag || {
      name: trimmedName,
      color: newTagColor,
    };

    onChange([...tags, tagToAdd]);
    setNewTagName("");
    setValidationError(null);
    setNewTagColor(TAG_COLOR_PALETTE[0]);
    inputRef.current?.focus();
  };

  const handleRemoveTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index);
    onChange(newTags);
  };

  const handleSelectSuggestion = (tag: ContactTag) => {
    if (!tags.some((t) => t.name.toLowerCase() === tag.name.toLowerCase())) {
      onChange([...tags, tag]);
    }
    setNewTagName("");
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div className="space-y-2">
      {/* Current tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, idx) => (
            <ContactTagBadge
              key={`${tag.name}-${idx}`}
              tag={tag}
              onRemove={disabled ? undefined : () => handleRemoveTag(idx)}
            />
          ))}
        </div>
      )}

      {/* Add tag button/input */}
      {!disabled && (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3 w-3 mr-1" />
              {placeholder}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-3">
              {/* Tag name input */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Nome da tag
                </label>
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Digite o nome..."
                    className={`h-8 text-sm ${validationError ? "border-destructive" : ""}`}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3"
                    onClick={handleAddTag}
                    disabled={!newTagName.trim() || !!validationError}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {validationError && (
                  <span className="text-xs text-destructive">
                    {validationError}
                  </span>
                )}
              </div>

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    Existentes
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {suggestions.map((tag, idx) => (
                      <button
                        key={`${tag.name}-${idx}`}
                        type="button"
                        onClick={() => handleSelectSuggestion(tag)}
                        className="transition-transform hover:scale-105"
                      >
                        <ContactTagBadge tag={tag} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Color picker */}
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground">Cor</span>
                <TagColorPicker
                  value={newTagColor}
                  onChange={setNewTagColor}
                />
              </div>

              {/* Preview */}
              {newTagName.trim() && (
                <div className="pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground block mb-1.5">
                    Preview
                  </span>
                  <ContactTagBadge
                    tag={{ name: newTagName.trim(), color: newTagColor }}
                  />
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
