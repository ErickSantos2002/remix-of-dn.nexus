/**
 * Detects if the last AI message is asking for a phone number or email,
 * so the widget can render a specialized input field.
 *
 * Priority: orchestrator hint (<!--input:phone--> etc.) > regex fallback
 */
export type SpecialInputType = "phone" | "email" | { type: "list"; count: number } | null;

// ── Hint-based detection (primary) ──────────────────────────────────

const HINT_REGEX = /<!--input:(phone|email|text)-->\s*$/;

/**
 * Strips the invisible orchestrator hint from message content for display.
 */
export function stripInputHint(content: string): string {
  return content.replace(HINT_REGEX, "").trimEnd();
}

function detectHint(content: string): SpecialInputType | "skip" {
  const match = content.match(HINT_REGEX);
  if (!match) return "skip"; // no hint found — fall through to regex
  const type = match[1];
  if (type === "phone") return "phone";
  if (type === "email") return "email";
  return null; // "text" hint → generic input
}

// ── Regex-based detection (fallback) ────────────────────────────────

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const PHONE_PATTERNS = [
  /whats\s*app|whatsapp|\bwpp\b|\bzap\b/i,
  /telefone|celular|contato|telefone de contato/i,
  /n[uú]mero\s*(de\s*)?(telefone|celular|contato|whats?\s*app|whats)/i,
  /seu\s*(n[uú]mero|tel|fone|whats?\s*app|whats|contato)/i,
  /qual\s*(e\s*)?o?\s*(seu\s*)?(n[uú]mero|telefone|celular|whats?\s*app|contato)/i,
  /me\s*(passe?|informe|envie|mande|diga)\s*(o?\s*seu\s*)?(n[uú]mero|telefone|celular|whats?\s*app|contato)/i,
];

const PHONE_CONFIRMATION_PATTERNS = [
  /\(\d{2}\)\s*\d{4,5}-?\d{4}/,                          // formatted phone like (61) 99844-8144
  /\+?\d[\d\s\-()]{9,}/,                                   // 10+ digit sequence (AI echoing number)
  /esse\s+(numero|telefone|contato|whats)/i,               // "esse número/telefone"
  // Removed: /manter\s+contato/i — caused false positive when AI asks "pra manter contato"
  /(recebemos|anotei|registrei|recebi|anotado|registrado)\s*.*(numero|telefone|contato|whats)/i,
  /enviou\s+o\s+mesmo\s+(telefone|numero|contato)/i,       // "enviou o mesmo telefone"
  /(obrigad[oa]|perfeito|otimo|certo|entendido).*(numero|telefone|contato)/i,
  /(numero|telefone|contato).*(anotado|registrado|recebido|salvo)/i,
];

const EMAIL_PATTERNS = [
  /e-?mail/i,
  /endereco\s*de\s*e-?mail/i,
  /qual\s*(e\s*)?o?\s*(seu\s*)?e-?mail/i,
  /me\s*(passe?|informe|envie|mande|diga)\s*(o?\s*seu\s*)?e-?mail/i,
  /seu\s*e-?mail/i,
];

const EMAIL_CONFIRMATION_PATTERNS = [
  /e-?mail\s+ainda\s+e/i,
  /e-?mail\s+continua\s+sendo/i,
  /confirma.*e-?mail/i,
  /e-?mail.*correto/i,
  /e-?mail.*certo/i,
  /e-?mail.*mesmo/i,
  /ainda\s+e\s+\S+@\S+/i,
  /continua\s+sendo\s+\S+@\S+/i,
  /\S+@\S+\.\S+/,  // If message contains an actual email address, it's likely a confirmation
];

export function detectInputType(messageContent: string | undefined | null): SpecialInputType {
  if (!messageContent) return null;

  // 1. Try orchestrator hint first
  const hintResult = detectHint(messageContent);
  if (hintResult !== "skip") return hintResult;

  // 2. Fallback to regex detection
  const text = normalizeText(messageContent);

  const hasPhone = PHONE_PATTERNS.some((pattern) => pattern.test(text));
  if (hasPhone) {
    const isConfirmation = PHONE_CONFIRMATION_PATTERNS.some((p) => p.test(text));
    if (isConfirmation) return null;
    return "phone";
  }

  const hasEmail = EMAIL_PATTERNS.some((pattern) => pattern.test(text));
  if (hasEmail) {
    const isConfirmation = EMAIL_CONFIRMATION_PATTERNS.some((p) => p.test(text));
    if (isConfirmation) return null;
    return "email";
  }

  // Detect numbered lists (e.g. "1. Option\n2. Option\n3. Option")
  const listItems = messageContent.match(/^\s*(\d+)\s*[.)]\s*.+/gm);
  if (listItems && listItems.length >= 2) {
    return { type: "list", count: listItems.length };
  }

  return null;
}
