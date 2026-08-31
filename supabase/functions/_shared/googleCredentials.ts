// Shared helper to resolve per-company Google OAuth credentials.
// Replaces the global GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars by
// reading credentials stored in the `companies` table for each workspace.

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

async function decryptToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

export type GoogleOAuthErrorCode =
  | "google_oauth_disabled"
  | "google_oauth_not_configured"
  | "workspace_not_found";

export class GoogleOAuthError extends Error {
  code: GoogleOAuthErrorCode;
  userMessage: string;
  constructor(code: GoogleOAuthErrorCode, userMessage: string) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
    this.name = "GoogleOAuthError";
  }
}

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  companyId: string;
}

/**
 * Resolves Google OAuth credentials for the given workspace.
 * Throws GoogleOAuthError when the company has not configured or activated
 * the integration. Always uses per-company credentials — no global fallback.
 */
export async function getGoogleCredentials(workspaceId: string): Promise<GoogleCredentials> {
  if (!workspaceId) {
    throw new GoogleOAuthError(
      "workspace_not_found",
      "Workspace nao informado para buscar credenciais do Google Calendar."
    );
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: ws } = await admin
    .from("workspaces")
    .select("company_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (!ws?.company_id) {
    throw new GoogleOAuthError(
      "workspace_not_found",
      "Empresa do workspace nao encontrada."
    );
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, google_client_id, google_client_secret, google_oauth_enabled")
    .eq("id", ws.company_id)
    .maybeSingle();

  if (!company?.google_client_id || !company?.google_client_secret) {
    throw new GoogleOAuthError(
      "google_oauth_not_configured",
      "Credenciais do Google Calendar nao configuradas. Cadastre o Client ID e o Client Secret em Configuracoes > Empresa."
    );
  }

  if (!company.google_oauth_enabled) {
    throw new GoogleOAuthError(
      "google_oauth_disabled",
      "Integracao com o Google Calendar esta inativa. Ative em Configuracoes > Empresa."
    );
  }

  const clientSecret = await decryptToken(company.google_client_secret, company.id);

  return {
    clientId: company.google_client_id,
    clientSecret,
    companyId: company.id,
  };
}

/**
 * Builds a standardized JSON response body for OAuth credential errors.
 */
export function googleOAuthErrorResponse(err: unknown): { error: string; code?: GoogleOAuthErrorCode } {
  if (err instanceof GoogleOAuthError) {
    return { error: err.userMessage, code: err.code };
  }
  const msg = err instanceof Error ? err.message : "Erro ao acessar credenciais do Google Calendar.";
  return { error: msg };
}
