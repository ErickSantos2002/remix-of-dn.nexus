// Mapeia códigos de erro da Meta Cloud API (WhatsApp Business) para mensagens
// amigáveis em pt-BR, com orientação prática de resolução.
//
// Referência: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes

export type FriendlyWhatsappError = {
  title: string;
  description: string;
};

type MetaErrorLike = {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { details?: string };
};

type EdgeErrorPayload = {
  error?: string;
  code?: string;
  meta_code?: number;
  message?: string;
  user_message?: string;
  details?: { error?: MetaErrorLike } | MetaErrorLike | unknown;
};

function extractMetaError(payload: unknown): MetaErrorLike | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as EdgeErrorPayload;
  const details = p.details as { error?: MetaErrorLike } | MetaErrorLike | undefined;
  if (details && typeof details === "object") {
    if ("error" in details && details.error) return details.error as MetaErrorLike;
    if ("code" in details || "message" in details) return details as MetaErrorLike;
  }
  return null;
}

export function friendlyWhatsappError(
  raw: unknown,
  fallbackTitle = "Erro ao enviar mensagem"
): FriendlyWhatsappError {
  const meta = extractMetaError(raw);
  const edgePayload = raw as EdgeErrorPayload;
  const code = meta?.code ?? edgePayload?.meta_code;
  const rawMsg =
    edgePayload?.user_message ||
    edgePayload?.message ||
    (raw && typeof raw === "object" && edgePayload.error) ||
    meta?.message ||
    (raw instanceof Error ? raw.message : "") ||
    "Erro desconhecido";

  // Nossa própria sinalização de janela fechada
  if (edgePayload?.code === "WINDOW_CLOSED") {
    return {
      title: "Janela de 24h fechada",
      description:
        "O lead não respondeu nas últimas 24h. Envie um modelo aprovado (HSM) para reabrir a conversa.",
    };
  }

  if (edgePayload?.code === "RECIPIENT_NOT_ALLOWED") {
    return {
      title: "Número não liberado para teste",
      description: rawMsg,
    };
  }

  switch (code) {
    case 131030:
      return {
        title: "Número não liberado para teste",
        description:
          'Sua conta do WhatsApp Business ainda está em modo de teste. Adicione o número do lead à lista de destinatários permitidos na Meta, ou coloque o app em produção para enviar mensagens a qualquer número.',
      };
    case 131047:
      return {
        title: "Janela de 24h expirada",
        description:
          "Não é possível enviar mensagens livres após 24h da última resposta do lead. Envie um modelo aprovado (HSM) para reabrir a conversa.",
      };
    case 131051:
      return {
        title: "Tipo de mensagem não suportado",
        description: "O tipo de mensagem enviado não é aceito pelo WhatsApp Business API.",
      };
    case 131026:
      return {
        title: "Mensagem não entregue",
        description:
          "O destinatário não pôde receber a mensagem (número inválido, sem WhatsApp, ou bloqueado).",
      };
    case 131056:
      return {
        title: "Limite de pares (remetente/destinatário)",
        description:
          "Muitas mensagens para o mesmo par remetente/destinatário em pouco tempo. Aguarde alguns instantes e tente novamente.",
      };
    case 131009:
      return {
        title: "Parâmetro inválido",
        description: meta?.error_data?.details || meta?.message || rawMsg,
      };
    case 132000:
    case 132001:
    case 132005:
    case 132007:
    case 132012:
    case 132015:
    case 132016:
      return {
        title: "Erro no modelo (HSM)",
        description:
          meta?.error_data?.details ||
          "Modelo inválido, pausado ou com variáveis incorretas. Verifique o modelo em Configurações → Modelos de WhatsApp.",
      };
    case 190:
    case 200:
    case 10:
    case 4:
      return {
        title: "Erro de autenticação/permissão",
        description:
          "O token de acesso está inválido, expirado ou sem permissão. Reconfigure a conexão do WhatsApp Business.",
      };
    case 133000:
    case 133004:
    case 133005:
    case 133006:
    case 133008:
    case 133009:
    case 133010:
      return {
        title: "Problema com o número (phone_number_id)",
        description:
          "O número do WhatsApp Business associado à conexão está com restrição ou não foi registrado corretamente na Meta.",
      };
    case 130497:
      return {
        title: "Conta restrita para o Brasil",
        description:
          "A Meta bloqueou o envio porque esta conta do WhatsApp Business está restrita para enviar mensagens a usuários neste país. Revise a restrição/eligibilidade da conta na Meta antes de reenviar.",
      };
    default:
      return {
        title: fallbackTitle,
        description: meta?.error_data?.details || meta?.message || rawMsg,
      };
  }
}
