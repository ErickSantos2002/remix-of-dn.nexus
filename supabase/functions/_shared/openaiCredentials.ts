// Shared helper to resolve per-company OpenAI API key.
// Reads encrypted key from `companies.openai_api_key` (AES-GCM + PBKDF2,
// passphrase = company_id) and validates the `openai_enabled` flag.

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

export async function decryptOpenAIToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

export type OpenAIErrorCode =
  | "openai_disabled"
  | "openai_not_configured"
  | "workspace_not_found";

export class OpenAIError extends Error {
  code: OpenAIErrorCode;
  userMessage: string;
  constructor(code: OpenAIErrorCode, userMessage: string) {
    super(userMessage);
    this.code = code;
    this.userMessage = userMessage;
    this.name = "OpenAIError";
  }
}

export interface OpenAICredentials {
  apiKey: string;
  companyId: string;
}

/**
 * Resolves the OpenAI API key for the given workspace.
 * Throws OpenAIError when the company has not configured or activated the integration.
 */
export async function getOpenAIKey(workspaceId: string): Promise<OpenAICredentials> {
  if (!workspaceId) {
    throw new OpenAIError("workspace_not_found", "Workspace nao informado.");
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
    throw new OpenAIError("workspace_not_found", "Empresa do workspace nao encontrada.");
  }

  const { data: company } = await admin
    .from("companies")
    .select("id, openai_api_key, openai_enabled")
    .eq("id", ws.company_id)
    .maybeSingle();

  if (!company?.openai_api_key) {
    throw new OpenAIError(
      "openai_not_configured",
      "Chave da OpenAI nao configurada. Cadastre em Configuracoes > Empresa."
    );
  }

  if (!company.openai_enabled) {
    throw new OpenAIError(
      "openai_disabled",
      "Integracao com a OpenAI esta inativa. Ative em Configuracoes > Empresa."
    );
  }

  const apiKey = await decryptOpenAIToken(company.openai_api_key, company.id);
  return { apiKey, companyId: company.id };
}

export function openAIErrorResponse(err: unknown): { error: string; code?: OpenAIErrorCode } {
  if (err instanceof OpenAIError) {
    return { error: err.userMessage, code: err.code };
  }
  const msg = err instanceof Error ? err.message : "Erro ao acessar credenciais da OpenAI.";
  return { error: msg };
}
