/**
 * Phone number utilities for Brazilian format
 * Handles normalization (storage) and formatting (display)
 */

/**
 * Normalizes a phone number by removing all non-digit characters
 * and ensuring the Brazilian country code (55) is present.
 *
 * @example
 * normalizePhone("+55 (11) 99999-9999") // "5511999999999"
 * normalizePhone("(11) 99999-9999")     // "5511999999999"
 * normalizePhone("55 11 99999-9999")    // "5511999999999"
 * normalizePhone("11999999999")         // "5511999999999"
 * normalizePhone(null)                  // null
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, "");

  // Add Brazilian country code (55) if not present
  // Numbers with 10-11 digits (DDD + number) without 55 prefix should get it added
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
    digits = "55" + digits;
  }

  // Convert old 8-digit mobile to 9-digit format
  // 55 + DDD(2) + 8 digits starting with [6-9] → add "9" after DDD
  if (digits.length === 12 && digits.startsWith("55")) {
    const numberPart = digits.slice(4);
    if (/^[6-9]/.test(numberPart)) {
      digits = digits.slice(0, 4) + "9" + numberPart;
    }
  }

  // Return null if empty after processing
  if (!digits) return null;

  return digits;
}

/**
 * Formats a normalized phone number for display.
 * Handles phones with or without the 55 country code.
 *
 * @example
 * formatPhoneForDisplay("5511999999999") // "(11) 99999-9999" (mobile with 55)
 * formatPhoneForDisplay("11999999999")   // "(11) 99999-9999" (mobile)
 * formatPhoneForDisplay("551133334444")  // "(11) 3333-4444" (landline with 55)
 * formatPhoneForDisplay("1133334444")    // "(11) 3333-4444" (landline)
 * formatPhoneForDisplay(null)            // ""
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return "";

  // Remove any remaining non-digits (safety)
  let digits = phone.replace(/\D/g, "");

  if (!digits) return "";

  // Remove 55 prefix for display formatting if present
  if (digits.length >= 12 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  // 11 digits: DDD + 9-digit mobile (11 99999-9999)
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  // 10 digits: DDD + 8-digit landline (11 3333-4444)
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  // 9 digits: Mobile without DDD (99999-9999)
  if (digits.length === 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  // 8 digits: Landline without DDD (3333-4444)
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  // Other lengths: return as-is
  return digits;
}

/**
 * Extracts the Brazilian DDD (area code) from a phone number.
 * Returns the 2-digit DDD as a string, or null if it cannot be determined.
 *
 * @example
 * extractDDD("5511999999999") // "11"
 * extractDDD("11999999999")   // "11"
 * extractDDD("999999999")     // null (no DDD)
 * extractDDD(null)            // null
 */
export function extractDDD(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  // Strip 55 country code if present and remaining length looks like DDD+number
  if (digits.length >= 12 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  // Need at least DDD (2) + some number digits
  if (digits.length < 10) return null;

  const ddd = digits.slice(0, 2);
  // DDD must be numeric and within valid Brazilian range (11-99)
  const dddNum = parseInt(ddd, 10);
  if (isNaN(dddNum) || dddNum < 11 || dddNum > 99) return null;

  return ddd;
}

/**
 * Validates if a phone number is a valid Brazilian format after normalization.
 * Valid formats have 10-11 digits (without 55) or 12-13 digits (with 55).
 *
 * @example
 * isValidBrazilianPhone("5511999999999") // true (mobile with 55)
 * isValidBrazilianPhone("11999999999")   // true (mobile)
 * isValidBrazilianPhone("551133334444")  // true (landline with 55)
 * isValidBrazilianPhone("1133334444")    // true (landline)
 * isValidBrazilianPhone("999999999")     // false (no DDD)
 * isValidBrazilianPhone(null)            // false
 */
export function isValidBrazilianPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;

  let digits = phone.replace(/\D/g, "");

  // Remove 55 prefix for validation if present
  if (digits.length >= 12 && digits.startsWith("55")) {
    digits = digits.slice(2);
  }

  // Must have 10 (landline) or 11 (mobile) digits
  if (digits.length !== 10 && digits.length !== 11) {
    return false;
  }

  // DDD must be between 11 and 99
  const ddd = parseInt(digits.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) {
    return false;
  }

  // Mobile numbers (11 digits) must start with 9 after DDD
  if (digits.length === 11 && digits[2] !== "9") {
    return false;
  }

  return true;
}

/** DDDs validos no Brasil */
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

function isSequentialDigits(s: string): boolean {
  let asc = true;
  let desc = true;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (diff !== 1) asc = false;
    if (diff !== -1) desc = false;
  }
  return asc || desc;
}

/**
 * Valida se o numero e um celular brasileiro plausivel (real).
 * Alem do formato (DDD + nono digito), bloqueia padroes obviamente ficticios:
 * digitos repetidos, sequencias e metades identicas.
 *
 * @example
 * isRealBrazilianMobile("(11) 98765-4321") // true
 * isRealBrazilianMobile("(31) 99999-9999") // false (repetidos)
 * isRealBrazilianMobile("(11) 91234-5678") // false (sequencia)
 * isRealBrazilianMobile("(11) 91234-1234") // false (metades identicas)
 * isRealBrazilianMobile("(20) 98765-4321") // false (DDD invalido)
 */
export function isRealBrazilianMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;

  let digits = String(phone).replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length !== 11) return false;

  const ddd = parseInt(digits.slice(0, 2), 10);
  if (!VALID_DDDS.has(ddd)) return false;

  const number = digits.slice(2); // 9 digitos
  if (number[0] !== "9") return false;

  // Todos os digitos iguais (999999999) ou os 8 finais iguais (911111111)
  if (/^(\d)\1{8}$/.test(number)) return false;
  if (/^9(\d)\1{7}$/.test(number)) return false;

  // Sequencias crescentes/decrescentes (912345678 / 987654321)
  if (isSequentialDigits(number.slice(1))) return false;

  // Metades identicas: 9 XXXX-XXXX com XXXX == XXXX
  if (number.slice(1, 5) === number.slice(5, 9)) return false;

  return true;
}
