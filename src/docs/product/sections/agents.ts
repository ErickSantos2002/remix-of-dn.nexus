import type { DocSection } from "../types";

export const agentsSections: DocSection[] = [
  {
    id: "agentes",
    number: "2",
    title: "Agentes de IA",
    summary:
      "Personas de inteligência artificial que atendem os leads em nome da empresa, com prompt, tom de voz, categoria, palavras-chave, ferramentas e bases de conhecimento próprias.",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "Um agente é a configuração de uma persona de IA: quem ela e, como fala, o que sabe (bases de conhecimento vinculadas), o que pode executar (ferramentas) e em qual assunto atua (categoria). Cada workspace tem sua própria frota de agentes, e o orquestrador escolhe automaticamente qual agente responde cada mensagem.",
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Tabela", "Para que serve", "Campos-chave"],
        rows: [
          [
            "agents (modelo legado)",
            "Agentes criados no modelo antigo, ainda ativos",
            "workspace_id, name, persona_prompt, tone, keywords[], category_id, is_default_for_category, live_chat_enabled, message_debounce_seconds",
          ],
          [
            "agent_instances (modelo atual)",
            "Agentes criados a partir de templates",
            "workspace_id, template_id, name, system_prompt, tone, icon, is_customized, knowledge_base_id, is_active, is_archived",
          ],
          [
            "agent_templates",
            "Marketplace de modelos prontos de agente",
            "name, system_prompt, tone, category, version, is_published, usage_count, rating",
          ],
          [
            "tenant_agent_templates",
            "Libera templates privados para empresas específicas",
            "template_id, company_id",
          ],
          [
            "agent_categories",
            "Categorias dinâmicas por workspace (Vendas, Suporte, RH...)",
            "workspace_id, name, slug, icon, color, is_system, is_active",
          ],
          [
            "agent_tools / tool_catalog",
            "Ferramentas (function calling) habilitadas por agente",
            "agent_id, tool_id, is_enabled, config / name, function_schema, default_config",
          ],
          [
            "agent_knowledge_bases",
            "Vínculo N:N entre agente e bases de conhecimento",
            "agent_id, knowledge_base_id",
          ],
          [
            "agent_transfers",
            "Histórico de transferências entre agentes de IA",
            "lead_id, from_agent_id, to_agent_id, from_intent, to_intent, reason",
          ],
          [
            "agent_availability",
            "Disponibilidade dos atendentes humanos (não da IA): status derivado de crm_agent_calendars (horário/dias/fuso) + crm_holidays, manual pause via is_accepting_leads, carga calculada por RPC",
            "user_id, max_concurrent_leads, is_accepting_leads",
          ],
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "GET/POST /agents, GET/PUT/DELETE /agents/{id} — o GET unifica agents e agent_instances em uma única lista.",
          "POST /agents/from-template — cria um agente clonando um template e incrementa o contador de uso do template.",
          "GET/PUT /agents/{id}/tools e GET/PUT /agents/{id}/knowledge-bases — o PUT substitui todo o conjunto.",
          "CRUD /agent-categories — categorias do workspace.",
          "/agent-templates — leitura livre dos templates publicados; escrita apenas para super admin.",
          "GET/PUT /availability e /routing/config — disponibilidade e estratégia de distribuição para humanos.",
        ],
      },
      { type: "subheading", text: "Permissões" },
      {
        type: "list",
        items: [
          "Todo acesso e limitado ao workspace (RLS via is_workspace_member).",
          "Criar, editar e publicar templates globais e exclusivo de super admin.",
          "Membros veem e operam apenas os workspaces aos quais pertencem; admins e super admins veem todos.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Um agente só entra na seleção automática se estiver ativo e com o chat ao vivo habilitado (live_chat_enabled).",
          "A seleção segue a ordem: categoria da intenção detectada > manter o agente atual se já for da categoria certa > casamento por palavras-chave > agente padrão da categoria > primeiro disponível. Sem categoria compatível, cai para GERAL.",
          "Proteção contra troca precoce: nas primeiras mensagens da conversa o lead permanece com o agente atual, mesmo que a intenção oscile.",
          "Toda transferência entre agentes é registrada em agent_transfers e o lead recebe uma mensagem de aviso da troca.",
          "Cada agente tem um tempo de debounce (padrão 5 segundos) para agrupar rajadas de mensagens do lead antes de responder.",
          "Exclusão de agente e lógica (arquivamento), preservando o histórico das conversas.",
        ],
      },
    ],
  },
  {
    id: "orquestrador",
    number: "3",
    title: "Orquestrador de IA",
    summary:
      "Motor que processa cada mensagem recebida: entende a intenção, escolhe o agente, busca conhecimento, decide ferramentas, gera a resposta e aciona o humano quando necessário.",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "O orquestrador e a inteligência central do atendimento. Ele e disparado automaticamente sempre que uma mensagem do lead entra no sistema (WhatsApp, widget ou chat interno) e conduz todo o raciocínio até a resposta enviada.",
      },
      { type: "subheading", text: "Pipeline de processamento" },
      {
        type: "table",
        headers: ["Etapa", "O que acontece"],
        rows: [
          ["1. Filtro de entrada", "Somente mensagens de lead são processadas."],
          [
            "2. Saudação inicial",
            "Mensagens de inicialização geram uma saudação personalizada com a persona do agente atribuído.",
          ],
          [
            "3. Trava humana",
            "Se o lead estiver com status human_talking / needs_human ou atribuído a um usuário, a IA não responde.",
          ],
          [
            "4. Debounce e agregação",
            "Aguarda o tempo configurado no agente e junta mensagens consecutivas do lead em um único contexto.",
          ],
          [
            "5. Detecção de sessão",
            "Identifica se e uma nova conversa, sem reset forçado por tempo (decisão feita pelo modelo).",
          ],
          [
            "6. Análise paralela",
            "Intenção, sentimento, insights (urgência, objeções) e extração de dados do contato rodam ao mesmo tempo.",
          ],
          [
            "7. Seleção / transferência de agente",
            "Define qual agente responde e registra transferência quando ha troca.",
          ],
          [
            "8. RAG",
            "Busca híbrida (palavra-chave + semântica) nas bases vinculadas ao agente.",
          ],
          [
            "9. Ferramentas",
            "Decide via modelo se deve chamar uma ferramenta (ex.: agendar reunião) e executa.",
          ],
          [
            "10. Geração e divisão da resposta",
            "Gera o texto e divide em blocos de ~300 caracteres com atraso de digitação.",
          ],
          [
            "11. Handoff",
            "Quando ha pedido explícito de humano ou sentimento muito negativo, coloca o lead na fila/atribuição humana.",
          ],
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "A IA nunca responde por cima de um humano: qualquer atribuição humana bloqueia a geração automática.",
          "Antialucinação: a resposta se apoia no conteúdo recuperado; datas, horários e nomes nunca são inventados — agendamento só acontece via ferramenta.",
          "Handoff em duas etapas: a IA sugere a transferência e só executa após confirmação do lead.",
          "Respostas longas são quebradas em blocos curtos; se o lead escrever no meio do envio, o restante e interrompido.",
          "Lead perdido no CRM que volta a falar com intenção comercial e reaberto automaticamente no primeiro estágio do funil, com registro no histórico.",
          "Extração de dados do contato e não destrutiva: apenas campos vazios são preenchidos.",
          "Toda comunicação com o lead e em português do Brasil e no fuso America/São_Paulo.",
        ],
      },
      { type: "subheading", text: "Roteamento para humanos" },
      {
        type: "list",
        items: [
          "Disponibilidade derivada do calendário de trabalho do atendente (dias, horários, timezone) mais holidays do workspace, manual pause via is_accepting_leads, e capacidade disponível (max_concurrent_leads).",
          "Estratégias implementadas: menos carregado (least_loaded) e rodízio (round_robin); por competência e por desempenho estão em desenvolvimento.",
          "Precedência: se a lead já tem um responsável no card do CRM, ele ganha a atribuição (respect_card_owner = true). Sem atendente disponível, a lead entra em lead_queues com prioridade calculada pela urgência detectada.",
          "A fila é drenada pelo routing-queue-worker a cada 5 minutos: quando um atendente fica disponível, o worker atribui as leads em espera e dispara notificações.",
        ],
      },
    ],
  },
  {
    id: "base-conhecimento",
    number: "4",
    title: "Base de Conhecimento",
    summary:
      "Repositório de documentos da empresa transformados em conhecimento pesquisável pela IA (RAG).",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "Cada base de conhecimento agrupa documentos (PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, HTML, JSON) que são fatiados em trechos e vetorizados. Os agentes vinculados a essas bases consultam esses trechos para responder com informação real da empresa.",
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Componente", "Papel"],
        rows: [
          ["knowledge_bases", "Agrupador por workspace (nome, descrição)."],
          [
            "documents",
            "Trechos do documento com conteúdo, metadados e vetor de embedding de 1536 dimensões.",
          ],
          [
            "document_processing_jobs",
            "Acompanhamento do processamento: status, trechos criados, embeddings gerados, progresso e erros.",
          ],
          [
            "agent_knowledge_bases",
            "Define quais bases cada agente pode consultar.",
          ],
          [
            "Processamento em duas fases",
            "Extração de texto e fatiamento rápidos, depois geração de embeddings em segundo plano em lotes.",
          ],
          [
            "Busca (match_documents)",
            "Similaridade de cosseno com filtro pelas bases do agente.",
          ],
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "GET/POST /knowledge-bases e GET/PUT/DELETE /knowledge-bases/{id}.",
          "GET/POST /knowledge-bases/{id}/documents e DELETE de documento.",
          "GET /knowledge-bases/{id}/jobs — status de processamento.",
          "POST /knowledge-bases/{id}/regenerate-embeddings — reprocessa a vetorização.",
          "POST /knowledge-bases/{id}/search — busca semântica direta na base.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Fatiamento respeita parágrafos e frases para não cortar o sentido do texto; trechos vazios ou sem conteúdo útil são descartados.",
          "A vetorização roda em segundo plano em lotes, com retomada automática quando o processamento e interrompido.",
          "A busca combina palavras-chave e semântica; consultas muito curtas usam apenas palavras-chave por performance.",
          "Perguntas de continuação são reescritas com o tópico da conversa antes da busca.",
          "A recuperação usa limite de similaridade e devolve no máximo 5 trechos, priorizando correspondências exatas.",
          "Acesso restrito aos membros do workspace dono da base.",
        ],
      },
    ],
  },
];
