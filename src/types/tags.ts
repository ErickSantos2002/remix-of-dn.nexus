/**
 * Contact Tag Types
 * Structure for JSONB tags in crm_contacts table
 */

export interface ContactTag {
  name: string;
  color: string;
}

/**
 * Predefined color palette for tags
 * Same colors used in AgentCategories for consistency
 */
export const TAG_COLOR_PALETTE = [
  "#22C55E", // green
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#F59E0B", // amber
  "#14B8A6", // teal
  "#EF4444", // red
  "#64748B", // slate
  "#A855F7", // violet
  "#6B7280", // gray
] as const;

export type TagColor = typeof TAG_COLOR_PALETTE[number];

/**
 * Get a consistent default color based on tag name hash
 * Same algorithm used in the database migration
 */
export function getDefaultTagColor(tagName: string): string {
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = ((hash << 5) - hash) + tagName.charCodeAt(i);
    hash = hash & hash;
  }
  return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length];
}

/**
 * Parse tags from database (handles Json type from Supabase)
 */
export function parseTags(tags: unknown): ContactTag[] {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.filter(
      (tag): tag is ContactTag =>
        typeof tag === "object" &&
        tag !== null &&
        typeof tag.name === "string" &&
        typeof tag.color === "string"
    );
  }
  return [];
}
