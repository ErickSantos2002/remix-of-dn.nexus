// Helper compartilhado: chamadas ao Gemini com fallback automatico Lovable AI Gateway.
// - Se a empresa tem chave propria ativada e validada: chama Google direto.
// - Mapeia gemini-3-*-preview (exclusivos Lovable) para equivalentes 2.5 quando usa chave da empresa.
// - Em qualquer erro, faz fallback transparente para Lovable AI Gateway (LOVABLE_API_KEY).

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
    ["encrypt", "decrypt"],
  );
}

export async function decryptGeminiToken(encrypted: string, passphrase: string): Promise<string> {
  const data = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ct = data.slice(SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(passphrase, salt);
  const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(dec);
}

export async function encryptGeminiToken(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  const out = new Uint8Array(SALT_LENGTH + IV_LENGTH + ct.byteLength);
  out.set(salt, 0); out.set(iv, SALT_LENGTH); out.set(new Uint8Array(ct), SALT_LENGTH + IV_LENGTH);
  return btoa(String.fromCharCode(...out));
}

// Modelos publicos do Google que sao testados na validacao da chave do cliente.
export const REQUIRED_PUBLIC_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;
export const REQUIRED_EMBEDDING_MODEL = "gemini-embedding-001" as const;

// Mapeia modelo "estilo Lovable" (com prefixo google/ e possiveis nomes preview) para o
// modelo equivalente disponivel na API publica do Google quando estamos usando a chave do cliente.
export function mapToGoogleModel(model: string): string {
  const m = model.replace(/^google\//, "");
  if (m === "gemini-3-flash-preview") return "gemini-2.5-flash";
  if (m === "gemini-3-pro-preview") return "gemini-2.5-pro";
  // 3.1 ainda nao esta na API publica do Google; usa o Pro validado na chave do cliente
  if (m === "gemini-3.1-pro-preview") return "gemini-2.5-pro";
  return m;
}

// Quando o Lovable AI Gateway nao conhece o modelo pedido, tentamos o equivalente
// imediatamente abaixo em vez de falhar. Mantem a configuracao "gemini-3.1-pro"
// utilizavel antes de o gateway passar a aceita-la.
const LOVABLE_MODEL_DOWNGRADES: Record<string, string> = {
  "google/gemini-3.1-pro-preview": "google/gemini-3-pro-preview",
  "google/gemini-3-pro-preview": "google/gemini-2.5-pro",
};

// deno-lint-ignore no-explicit-any
type SB = any;

export type GeminiConfig = {
  enabled: boolean;
  apiKey: string | null;
};

const cache = new Map<string, { value: GeminiConfig; expires: number }>();
const CACHE_TTL = 60_000;

export async function getCompanyGeminiConfig(supabase: SB, companyId: string | null | undefined): Promise<GeminiConfig> {
  if (!companyId) return { enabled: false, apiKey: null };
  const now = Date.now();
  const cached = cache.get(companyId);
  if (cached && cached.expires > now) return cached.value;

  const { data } = await supabase
    .from("companies")
    .select("id, gemini_api_key, gemini_enabled, gemini_validated_at")
    .eq("id", companyId)
    .maybeSingle();

  let result: GeminiConfig = { enabled: false, apiKey: null };
  if (data?.gemini_enabled && data?.gemini_api_key && data?.gemini_validated_at) {
    try {
      const decrypted = await decryptGeminiToken(data.gemini_api_key as string, data.id as string);
      result = { enabled: true, apiKey: decrypted };
    } catch (e) {
      console.warn("[gemini-client] failed to decrypt company key:", e instanceof Error ? e.message : e);
    }
  }
  cache.set(companyId, { value: result, expires: now + CACHE_TTL });
  return result;
}

export function invalidateGeminiCache(companyId: string) {
  cache.delete(companyId);
}

// Resolve company_id via workspace_id (helper opcional para quem so tem o workspace).
export async function resolveCompanyIdFromWorkspace(supabase: SB, workspaceId: string | null | undefined): Promise<string | null> {
  if (!workspaceId) return null;
  const { data } = await supabase.from("workspaces").select("company_id").eq("id", workspaceId).maybeSingle();
  return (data?.company_id as string) || null;
}

// ====== Chat completions (formato OpenAI-compativel) ======

type ChatMessage = { role: "system" | "user" | "assistant"; content: string | unknown };
type ChatCompletionBody = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  response_format?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
};

const LOVABLE_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callLovableChat(body: ChatCompletionBody, signal?: AbortSignal): Promise<Response> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  return fetch(LOVABLE_GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

// Adaptador OpenAI -> Gemini generateContent (apenas chat de texto).
async function callGoogleChat(apiKey: string, body: ChatCompletionBody, signal?: AbortSignal): Promise<Response> {
  const model = mapToGoogleModel(body.model);
  let systemText = "";
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of body.messages) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m.role === "system") { systemText += (systemText ? "\n\n" : "") + text; continue; }
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text }] });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload: Record<string, unknown> = { contents };
  if (systemText) payload.systemInstruction = { parts: [{ text: systemText }] };
  const generationConfig: Record<string, unknown> = {};
  if (body.max_tokens) generationConfig.maxOutputTokens = body.max_tokens;
  if (typeof body.temperature === "number") generationConfig.temperature = body.temperature;
  // JSON response_format
  // deno-lint-ignore no-explicit-any
  const rf = body.response_format as any;
  if (rf?.type === "json_object" || rf?.type === "json_schema") {
    generationConfig.responseMimeType = "application/json";
  }
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!resp.ok) return resp;

  const gemini = await resp.json();
  // Converte resposta Gemini -> formato OpenAI Chat Completions
  const choices = (gemini.candidates || []).map((c: { content?: { parts?: Array<{ text?: string }> }; finishReason?: string }, idx: number) => ({
    index: idx,
    message: {
      role: "assistant",
      content: (c.content?.parts || []).map((p) => p.text || "").join(""),
    },
    finish_reason: (c.finishReason || "stop").toLowerCase(),
  }));
  const openaiShaped = {
    id: `gemini-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices,
    usage: gemini.usageMetadata
      ? {
          prompt_tokens: gemini.usageMetadata.promptTokenCount || 0,
          completion_tokens: gemini.usageMetadata.candidatesTokenCount || 0,
          total_tokens: gemini.usageMetadata.totalTokenCount || 0,
        }
      : undefined,
  };
  return new Response(JSON.stringify(openaiShaped), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Faz uma chamada de chat completion usando a chave da empresa (se ativa) com fallback
 * automatico para Lovable AI Gateway. Retorna um Response compativel com o formato
 * OpenAI Chat Completions, para minimizar mudancas no codigo consumidor.
 *
 * Os modelos sao SEMPRE referenciados como "google/gemini-..." pelos chamadores; o helper
 * faz o mapeamento e o ajuste de URL/payload internamente.
 */
export async function chatCompletionWithFallback(
  body: ChatCompletionBody,
  opts: { companyId?: string | null; supabase?: SB; signal?: AbortSignal } = {},
): Promise<Response> {
  let cfg: GeminiConfig | null = null;
  if (opts.companyId && opts.supabase) {
    try { cfg = await getCompanyGeminiConfig(opts.supabase, opts.companyId); } catch { /* ignore */ }
  }

  if (cfg?.enabled && cfg.apiKey) {
    try {
      const resp = await callGoogleChat(cfg.apiKey, body, opts.signal);
      if (resp.ok) return resp;
      const errBody = await resp.text();
      console.warn(`[gemini-client] Google API ${resp.status} for ${body.model}, falling back to Lovable. body=${errBody.slice(0, 300)}`);
    } catch (e) {
      console.warn("[gemini-client] Google call threw, falling back to Lovable:", e instanceof Error ? e.message : e);
    }
  }

  const resp = await callLovableChat(body, opts.signal);
  if (resp.ok) return resp;

  // 400/404 no gateway normalmente significa modelo desconhecido; tenta o equivalente inferior.
  const downgrade = LOVABLE_MODEL_DOWNGRADES[body.model];
  if (downgrade && (resp.status === 400 || resp.status === 404)) {
    console.warn(`[gemini-client] Lovable ${resp.status} for ${body.model}, retrying with ${downgrade}`);
    return callLovableChat({ ...body, model: downgrade }, opts.signal);
  }

  return resp;
}
