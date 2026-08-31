/**
 * Origens (source) válidas para um contato no CRM.
 *
 * As origens selecionáveis pelo usuário agora são **dinâmicas por empresa**
 * e ficam em `public.crm_contact_sources` (gerenciadas em /settings/company).
 *
 * Use o hook `useContactSources` no frontend para popular dropdowns.
 * Este arquivo mantém apenas constantes legadas (system + fallback) para
 * código que ainda referencia valores fixos.
 *
 * Edge Functions Deno validam contra a tabela diretamente (não importam daqui).
 */

/** Origens geradas internamente pelo sistema (não aparecem no dropdown da UI). */
export const CONTACT_SOURCE_SYSTEM = [
  "manual",      // criação manual no CRM
  "pipeline",    // default ao criar lead pelo pipeline
  "importacao",  // importação CSV
  "widget",      // chat widget
  "whatsapp",    // Z-API / WhatsApp Official
  "api",         // criação via API externa
] as const;

/** Fallback usado quando a API recebe um valor de origem desconhecido. */
export const CONTACT_SOURCE_FALLBACK = "API - Origem não identificada";
