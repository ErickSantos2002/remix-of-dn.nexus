// Shared helper to resolve per-company Resend API key.
// Reads encrypted key from `companies.resend_api_key` (AES-GCM + PBKDF2,
// passphrase = company_id) and validates the `resend_enabled` flag.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function decryptResendToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

export type ResendErrorCode =
  | "resend_disabled"
  | "resend_not_configured"
  | "company_not_found";

export class ResendError extends Error {
  code: ResendErrorCode;
  userMessage: string;
  constructor(code: ResendErrorCode, userMessage: string) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
    this.name = "ResendError";
  }
}

export interface ResendCredentials {
  apiKey: string;
  companyId: string;
  fromEmail: string | null;
}

/**
 * Resolves the Resend API key for the given company.
 * Throws ResendError when the company has not configured or activated the integration.
 */
export async function getResendKey(companyId: string): Promise<ResendCredentials> {
  if (!companyId) {
    throw new ResendError("company_not_found", "Empresa nao informada.");
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: company } = await admin
    .from("companies")
    .select("id, resend_api_key, resend_enabled, resend_from_email")
    .eq("id", companyId)
    .maybeSingle();

  if (!company) {
    throw new ResendError("company_not_found", "Empresa nao encontrada.");
  }

  if (!company.resend_api_key) {
    throw new ResendError(
      "resend_not_configured",
      "Chave da Resend nao configurada. Cadastre em Configuracoes > Empresa."
    );
  }

  if (!company.resend_enabled) {
    throw new ResendError(
      "resend_disabled",
      "Integracao com a Resend esta inativa. Ative em Configuracoes > Empresa."
    );
  }

  const apiKey = await decryptResendToken(company.resend_api_key, company.id);
  return { apiKey, companyId: company.id, fromEmail: company.resend_from_email ?? null };
}

export function resendErrorResponse(err: unknown): { error: string; code?: ResendErrorCode } {
  if (err instanceof ResendError) {
    return { error: err.userMessage, code: err.code };
  }
  const msg = err instanceof Error ? err.message : "Erro ao acessar credenciais da Resend.";
  return { error: msg };
}

export const RESEND_FROM_NOT_CONFIGURED =
  "Dominio de envio nao configurado. Cadastre em Configuracoes > Empresa > Integracao Resend.";

/**
 * Builds the "Name <address>" From header from the company's configured sender domain.
 * `rawFromEmail` may be a bare domain ("example.com") or a full address ("noreply@example.com").
 * Returns null when the company has no sender domain configured.
 */
export function resolveFromAddress(rawFromEmail: string | null | undefined, label?: string): string | null {
  const raw = typeof rawFromEmail === "string" ? rawFromEmail.trim() : "";
  if (!raw) return null;
  const address = raw.includes("@") ? raw : `noreply@${raw}`;
  const safeLabel = (label?.trim() || "Nexus AI").replace(/[<>"]/g, "");
  return `${safeLabel} <${address}>`;
}

/** Reads the company's configured sender domain/address (no Resend key requirement). */
export async function getCompanyFromEmail(companyId: string): Promise<string | null> {
  if (!companyId) return null;
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data } = await admin
    .from("companies")
    .select("resend_from_email")
    .eq("id", companyId)
    .maybeSingle();
  return (data?.resend_from_email as string | null) ?? null;
}

