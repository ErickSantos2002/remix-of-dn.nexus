import type { DocSection } from "../types";

export const platformSections: DocSection[] = [
  {
    id: "inbox",
    number: "5",
    title: "Chat ao vivo (Inbox)",
    summary:
      "Central única de conversas em tempo real com leads de WhatsApp e widgets, com passagem de bastao entre IA e atendente humano.",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "O Inbox reúne todas as conversas do workspace em uma tela: lista de leads, histórico de mensagens, insights da IA (sentimento, intenção, urgência, objeções) e ações de atendimento (assumir, transferir, resolver).",
      },
      { type: "subheading", text: "Ciclo de vida do lead" },
      {
        type: "table",
        headers: ["Status", "Significado"],
        rows: [
          ["new", "Lead recem-criado, ainda sem atendimento."],
          ["aí_talking", "IA conduzindo a conversa."],
          ["needs_human", "IA solicitou atendimento humano; lead na fila."],
          ["human_talking", "Atendente humano assumiu; a IA fica bloqueada."],
          ["closed", "Atendimento encerrado."],
        ],
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Tabela", "Papel"],
        rows: [
          [
            "leads",
            "Conversa/atendimento: status, agente de IA atribuído, atendente humano, telefone, resumo e insights da IA, origem, merge de duplicados, marcação de anonimizacao (LGPD).",
          ],
          [
            "messages",
            "Mensagens: remetente (lead/ia/humano), midia, id externo do canal, status de entrega (enviado/entregue/lido/falha), resposta citada.",
          ],
          [
            "zapi_conversations / whatsapp_conversations",
            "Espelho da conversa em cada canal, ligando o lead ao identificador da conexão.",
          ],
          ["lead_queues / lead_assignments", "Fila de espera e atribuição a atendentes humanos."],
          ["lead_read_state", "Controle de lido/não lido por usuário."],
          ["agent_transfers", "Histórico de transferências com motivo e intencoes envolvidas."],
        ],
      },
      { type: "subheading", text: "Recursos de mensagem" },
      {
        type: "list",
        items: [
          "Midias suportadas: imagem, áudio, vídeo, video-recado (PTV), figurinha, documento, cartao de contato (vCard) e localizacao.",
          "Transcricao automática de audios em português, com botão de repetir a transcrição.",
          "Gravacao de áudio no navegador em formato compatível com WhatsApp, com indicador de volume, pausa e limite de 5 minutos.",
          "Indicadores de entrega (um check, dois checks, lido) e botão de reenviar mensagens que ficaram sem entrega.",
          "Troca de canal da conversa (widget, Z-API, WhatsApp Oficial) quando o lead possui telefone.",
          "Links compartilhaveis da conversa via ?lead=ID.",
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "GET /inbox/leads, GET/PUT /inbox/leads/{id} — listagem com filtros de status e busca (leads mesclados são ocultados).",
          "GET/POST /inbox/leads/{id}/messages — o envio grava a mensagem e o disparo ao canal é feito automaticamente pelo banco.",
          "POST /inbox/leads/{id}/messages/{msgId}/transcribe — transcrição de áudio.",
          "PUT /inbox/leads/{id}/status, POST /inbox/leads/{id}/assign | transfer | resolve.",
          "GET /inbox/queue e POST /inbox/queue/process — fila de atendimento.",
          "POST /messages/send e /messages/send-media — envio genérico com roteamento automático de canal.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Assumir a conversa muda o status para human_talking e silencia a IA imediatamente.",
          "Janela de 24 horas do WhatsApp Oficial: fora dela, apenas modelos (HSM) aprovados podem ser enviados; texto livre e bloqueado.",
          "O campo de digitação fica travado quando a conversa esta atribuída a outro usuário ou a IA.",
          "Leads mesclados por duplicidade deixam de aparecer na lista e apontam para o lead principal.",
          "Conversas de widget ficam isoladas do canal WhatsApp até que o lead informe telefone.",
        ],
      },
    ],
  },
  {
    id: "conexões",
    number: "6",
    title: "Conexões e canais",
    summary:
      "Integrações de canal: WhatsApp via Z-API, WhatsApp Oficial (Meta), Google Calendar e telefonia VoIP, com proteções anti-ban e monitoramento de saúde.",
    blocks: [
      { type: "subheading", text: "Canais disponíveis" },
      {
        type: "table",
        headers: ["Canal", "Como funciona", "Observacoes"],
        rows: [
          [
            "Z-API (WhatsApp não oficial)",
            "Instancia com id + token validados junto a Z-API; QR Code para conectar o número.",
            "Token da conta fica na empresa; credenciais da instancia são criptografadas.",
          ],
          [
            "WhatsApp Oficial (Meta)",
            "Número verificado com phone_number_id, token de acesso e webhook.",
            "Sujeito a janela de 24h e envio de modelos aprovados.",
          ],
          [
            "Google Calendar",
            "OAuth por usuário para criar e sincronizar eventos das reuniões.",
            "Disponível também para membros.",
          ],
          [
            "Api4com (VoIP)",
            "Discagem, gravação, transcrição e análise de ligações por IA.",
            "Cada ligação vira uma atividade no CRM.",
          ],
        ],
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "list",
        items: [
          "connection_workspaces e a fonte da verdade do vínculo conexão <-> workspace (N:N), com palavras-chave, prioridade e conexão padrão.",
          "connection_health_daily consolida diariamente enviadas, entregues, lidas, falhas, taxa de entrega/leitura e contatos únicos.",
          "Credenciais de terceiros ficam criptografadas (AES-GCM + PBKDF2) na empresa; a API expoe apenas indicadores booleanos de 'configurado'.",
          "Verificacao periodica de saúde revalida instancias Z-API (conectado, status de pagamento, vencimento).",
        ],
      },
      { type: "subheading", text: "Proteções anti-ban" },
      {
        type: "list",
        items: [
          "Limites de envio por conexão e por lead, com espacamento entre mensagens.",
          "Disjuntor (circuit breaker) com estados fechado, aberto e meio-aberto: após sequência de falhas, os envios são suspensos e retomados em teste.",
          "Humanizacao das mensagens (blocos curtos, atraso de digitação) e jitter de alguns minutos nos disparos de régua.",
          "Aquecimento de números novos, opt-out (Não Perturbe) e janela de envio configurável por empresa.",
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "GET /connections e GET/PUT /connections/{id}/workspaces.",
          "GET /connections/{id}/health — métricas dos últimos 30 dias.",
          "Z-API: criar, validar instancia/token, revalidar, controlar instancia e obter QR Code.",
          "WhatsApp Oficial: criar, atualizar e enviar mensagem.",
          "Integrações Google: auth-url, callback, status e desconectar.",
          "Webhooks públicos de entrada: /webhooks/whatsapp e /webhooks/zapi.",
        ],
      },
      { type: "subheading", text: "Permissões" },
      {
        type: "list",
        items: [
          "Membros acessam o menu Conexões, cadastram o próprio Google Calendar e visualizam Z-API em modo leitura (incluindo QR Code).",
          "Alterar credenciais de instancia Z-API e exclusivo de super admin.",
          "WhatsApp Oficial permanece restrito a administradores.",
        ],
      },
    ],
  },
  {
    id: "agendamentos",
    number: "14",
    title: "Agendamentos",
    summary:
      "Motor de agenda: disponibilidade por vendedor, slots padronizados, widgets públicos de agendamento, lembretes e sincronização com Google Calendar.",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "Módulo que oferta horários livres, cria a reunião, gera a sala de vídeo, pública o evento no Google Calendar e dispara confirmacoes por e-mail e WhatsApp. Existem dois pontos de entrada: o widget público de agendamento e a ferramenta de agendamento usada pela IA na conversa.",
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Tabela", "Papel"],
        rows: [
          [
            "crm_appointments",
            "Reunião: contato, responsável, início/fim, status, evento do Google, sala e gravação, lembretes, entrada do convidado, duração real, widget de origem e playbook de análise.",
          ],
          [
            "crm_agent_calendars",
            "Disponibilidade do vendedor: horário de trabalho, dias da semana, intervalo mínimo entre reuniões, duração padrão e fuso.",
          ],
          [
            "workspace_meeting_settings",
            "Configuração geral do workspace, incluindo o tamanho do slot (passo entre horários candidatos) e o playbook padrão de análise.",
          ],
          [
            "scheduling_widgets / scheduling_widget_members",
            "Widget público: duração, janela de agendamento, qualificação ICP, textos de confirmação, estilo visual e eventos de conversão.",
          ],
          ["crm_holidays", "Feriados e datas bloqueadas do workspace."],
          [
            "crm_appointment_reminders / scheduling_blocked_attempts",
            "Lembretes enviados e tentativas bloqueadas pela qualificação.",
          ],
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Os dois motores (widget público e IA) usam a mesma lógica: respeitam feriados, horário de trabalho, intervalo mínimo e o passo de slot configurado no workspace.",
          "Buffer mínimo de 10 minutos: horários muito próximos do agora não são ofertados.",
          "Conflitos com reuniões existentes fazem o motor saltar para o próximo horário livre.",
          "O status da reunião e derivado: realizada quando houve início, no-show quando passou do horário sem início e sem cancelamento, cancelada ou futura.",
          "Qualificação ICP no widget bloqueia agendamentos fora do perfil e registra a tentativa com as dimensões reprovadas.",
          "Agendar pelo widget move o card para a etapa 'MQL - Reunião agendada' e dispara evento de conversão (Meta CAPI / Google Ads).",
          "O envio de e-mail do Google aos convidados é opcional (opção 'Notificar convidados por e-mail').",
          "Datas relevantes distintas: criação do contato, data em que a reunião foi marcada e data para a qual ela foi marcada.",
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "GET /appointments (com status derivado e filtros), GET /appointments/stats, POST /appointments.",
          "GET /appointments/availability — horários livres.",
          "POST /appointments/{id}/attendees e /sync-calendar.",
          "GET/PUT /agent-calendars/{agentId} — disponibilidade do vendedor.",
        ],
      },
    ],
  },
  {
    id: "reuniões",
    number: "15",
    title: "Reuniões por vídeo, gravação e transcrição",
    summary:
      "Salas de vídeo integradas, gravação, transcrição automática e insights de IA sobre o que foi conversado.",
    blocks: [
      { type: "subheading", text: "Funcionamento" },
      {
        type: "list",
        items: [
          "Cada reunião pode gerar uma sala de vídeo com link público protegido por validação de e-mail do convidado.",
          "A transcrição inicia automaticamente e o texto e indexado em trechos pesquisaveis para consultas de IA.",
          "Gravacoes até 100 MB ficam armazenadas na plataforma; acima disso, o acesso e por link externo.",
          "Recuperacao independente para transcrição e vídeo quando algum processamento falha.",
          "Insights e resumos são gerados por IA com prompts personalizaveis por empresa e tipo de atendimento.",
          "Exportação em lote das transcrições por período em CSV ou TXT.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "A entrada do convidado move o card de 'MQL - Reunião agendada' para 'SQL - Reunião realizada' apenas se ele estiver exatamente naquela etapa.",
          "O encerramento da reunião só é registrado quando a sala realmente expira, evitando falso encerramento.",
          "A interface das salas é apresentada em português do Brasil.",
        ],
      },
    ],
  },
  {
    id: "desempenho",
    number: "16",
    title: "Desempenho e análise por playbook",
    summary:
      "Avaliação automática dos atendimentos (reuniões, demonstrações e ligações) contra um playbook, com notas, pontos de desenvolvimento e coaching gerado por IA.",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "A empresa cadastra um playbook de atendimento; a IA extrai dele uma rubrica com critérios e pesos e avalia cada atendimento transcrito, gerando nota de 0 a 100, pontos fortes, melhorias, hábitos e reincidências por vendedor.",
      },
      { type: "subheading", text: "Estrutura de dados" },
      {
        type: "table",
        headers: ["Tabela", "Papel"],
        rows: [
          [
            "analysis_playbooks",
            "Playbook da empresa: tipos de atendimento cobertos, texto do playbook, diretrizes, modelo de IA, status e padrão.",
          ],
          [
            "analysis_rubric_versions / analysis_rubric_criteria",
            "Versionamento da rubrica e seus critérios (chave, etapa, peso, ordem, ativo).",
          ],
          [
            "activity_analysis_results",
            "Resultado por atendimento: nota, resumo, critérios avaliados, pontos fortes/melhorias, vendedor (com nome congelado), data em que ocorreu, status e marcação de desconsiderado.",
          ],
          [
            "seller_development_points",
            "Pontos de desenvolvimento por vendedor com contagem de ocorrências e status (recorrente, corrigido).",
          ],
          ["seller_coaching_briefs", "Briefing de coaching gerado por IA."],
          ["seller_achievements", "Conquistas e marcos do vendedor."],
        ],
      },
      { type: "subheading", text: "Abas da área /crm/desempenho" },
      {
        type: "list",
        items: [
          "Visão geral do time: evolução das notas por dia, semana ou mês.",
          "Ranking: nota média, tendência e pontos recorrentes por vendedor.",
          "Individual: detalhe do vendedor com histórico de avaliações.",
          "Meu desempenho: visão do próprio usuário.",
          "Operação (super admin): acompanhamento do processamento em lote das análises.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "O período considera a data em que o atendimento ocorreu, não a data em que foi processado.",
          "Somente análises concluidas, com nota e não desconsideradas entram no cálculo.",
          "Tendencia = média da segunda metade do período menos a média da primeira metade, em pontos.",
          "Reincidência não reduz a nota: é reportada separadamente para manter as notas comparáveis.",
          "Análise com nota 0 (atendimento que não atendeu aos critérios) e marcada automaticamente como desconsiderada.",
          "O nome do vendedor e congelado na análise, preservando o histórico mesmo após desligamento.",
          "Membros só enxergam a aba do próprio desempenho.",
        ],
      },
      {
        type: "list",
        items: ["Endpoint: GET /crm/performance/ranking (filtros de período e tipo de análise)."],
      },
    ],
  },
  {
    id: "analytics",
    number: "17",
    title: "Analytics e relatórios",
    summary:
      "Paineis de funil, coorte, ciclo de compra, reuniões, dores e objeções e saúde do WhatsApp.",
    blocks: [
      {
        type: "table",
        headers: ["Relatório", "O que mostra", "Regras principais"],
        rows: [
          [
            "Funil",
            "Snapshot atual por etapa e entradas no período.",
            "Entradas no período vem do histórico do card (to_stage_id), não do estado atual; ganhos e perdidos são agregados por ação do histórico.",
          ],
          [
            "Coorte",
            "Conversao sequencial entre etapas a partir do MQL.",
            "Permite desconsiderar leads específicos da contagem.",
          ],
          [
            "Ciclo de compra",
            "Tempo entre criação e fechamento dos leads ganhos.",
            "Média, mediana, p90, distribuição por faixas, quebra por origem/UTM, série mensal (12 meses) e quinzenal (6 meses), com comparacao de período anterior.",
          ],
          [
            "Reuniões",
            "Realizadas, remarcadas e no-show.",
            "Remarcacao não e cancelamento: são estados distintos.",
          ],
          [
            "Dores e objeções",
            "Frequência por item com detalhamento e exportação CSV.",
            "Filtros por etapa, status e responsável.",
          ],
          [
            "Saúde do WhatsApp",
            "Entregas, leituras, falhas e score de saúde por conexão.",
            "Base diaria consolidada por conexão.",
          ],
          [
            "Visão geral",
            "Leads, mensagens, fechamentos e taxa de conversão.",
            "Sempre escopado por workspace e período.",
          ],
        ],
      },
      {
        type: "list",
        items: [
          "Endpoints: /analytics/overview, /leads, /messages, /agents, /delivery, /connection-health, /analytics/sales-cycle, /analytics/pipeline e /crm/funnel/stats.",
          "Consultas grandes usam paginação interna para ultrapassar o limite de 1000 registros por consulta.",
        ],
      },
    ],
  },
  {
    id: "widgets",
    number: "18",
    title: "Widgets de chat no site",
    summary:
      "Chat de IA embutido em sites externos, com captacao de lead, qualificação e eventos de conversão.",
    blocks: [
      {
        type: "list",
        items: [
          "Configuração por widget: agente responsável, identificador público (slug), aparencia, mensagem de boas-vindas e domínios autorizados.",
          "Sessoes de visitante com token próprio e registro de eventos disparados.",
          "Detecção de campos especializados (telefone, e-mail, listas) sugeridos pela IA durante a conversa.",
          "Integração com Meta Pixel e Meta Conversions API para eventos de PageView, Lead e Agendamento.",
          "Endpoints públicos: GET /public/widgets/{slug} e POST /public/widgets/{slug}/sessions; CRUD autenticado em /widgets.",
          "Seguranca: validação de origem cruzada pelos domínios autorizados.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Leads do widget ficam isolados do WhatsApp até que um telefone seja informado; se o telefone coincidir com um contato existente, as conversas são unificadas.",
          "Mensagens de inicialização são ocultas na interface e servem para acionar a saudação do agente.",
        ],
      },
    ],
  },
  {
    id: "api",
    number: "19",
    title: "API pública e chaves de acesso",
    summary:
      "Gateway REST com mais de 200 endpoints, autenticação por JWT ou chave de API e documentação legivel por agentes de IA.",
    blocks: [
      { type: "subheading", text: "Autenticação" },
      {
        type: "list",
        items: [
          "JWT: POST /auth/login retorna o token, enviado em Authorization: Bearer.",
          "Chave de API: header X-API-Key, criada em /settings/api-keys.",
          "A chave completa é exibida uma única vez; o sistema guarda apenas o hash e o prefixo.",
          "Chaves possuem permissões por grupo de recurso, data de expiracao opcional e desativacao lógica.",
        ],
      },
      { type: "subheading", text: "Escopo por workspace" },
      {
        type: "list",
        items: [
          "A maioria dos endpoints exige o header X-Workspace-Id.",
          "Não exigem: auth, empresas, workspaces, conexões, convites, notificações, admin, templates de agente, públicos e webhooks.",
          "Paginação padrão: ?page=N&per_page=M (máximo de 100 por pagina).",
        ],
      },
      { type: "subheading", text: "Documentação" },
      {
        type: "list",
        items: [
          "Pagina interativa em /api/docs (OpenAPI).",
          "Especificacao formal em /openapi.yaml e /openapi.json.",
          "Versões em markdown para agentes de IA: /llms.txt, /llms-full.txt e /api-docs/index.md.",
          "Toda alteração na documentação carimba data e hora de Brasilia no cabecalho.",
        ],
      },
    ],
  },
  {
    id: "permissões",
    number: "20",
    title: "Multi-tenancy, perfis e permissões",
    summary:
      "Estrutura Empresa > Workspace > Recursos, com papeis de plataforma e papeis internos, isolamento por RLS e convites.",
    blocks: [
      { type: "subheading", text: "Hierarquia" },
      {
        type: "paragraph",
        text: "Usuário pertence a uma ou mais empresas; cada empresa possui workspaces; agentes, leads, contatos, conexões e demais recursos sempre pertencem a um workspace. Contatos são compartilhados no escopo da empresa; cards (leads) pertencem ao workspace.",
      },
      {
        type: "table",
        headers: ["Papel", "Acesso"],
        rows: [
          [
            "super_admin",
            "Painel administrativo, todas as empresas e workspaces, templates globais, criação de empresas e ações sensíveis.",
          ],
          [
            "admin",
            "Configuracoes da empresa, equipe e todos os dados dos workspaces da empresa.",
          ],
          ["member", "Apenas os workspaces atribuidos e o próprio desempenho."],
        ],
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "list",
        items: [
          "user_roles guarda o papel de plataforma; company_members e workspace_members guardam a associacao e o papel interno (owner, admin, member).",
          "Políticas de segurança no banco (RLS) usam as funções has_role, is_company_member e is_workspace_member.",
          "Convites por empresa e por workspace com token e prazo de expiracao.",
          "Configuração inicial: quando não existe nenhum usuário, a tela de login oferece a criação do primeiro administrador, empresa e workspace.",
        ],
      },
    ],
  },
  {
    id: "lgpd",
    number: "21",
    title: "Privacidade e LGPD",
    summary:
      "Ferramentas de atendimento a titulares: busca, anonimizacao e exclusão de dados com trilha de auditoria.",
    blocks: [
      {
        type: "list",
        items: [
          "Busca do titular por nome, telefone ou e-mail, com previa da quantidade de registros vinculados (conversas, mensagens, cards, agendamentos).",
          "Anonimizacao: substitui os dados identificaveis por hash e marca o registro como anonimizado.",
          "Exclusão definitiva em cascata respeitando as dependencias entre tabelas.",
          "Todas as execuções ficam registradas em log imutavel com tabelas afetadas, quantidade de registros, status e erros.",
          "O identificador do titular nunca e gravado em texto puro no log: apenas hash.",
          "Ação restrita a administradores, donos da empresa e super admins.",
          "Políticas de governanca: retencao de 90 dias, senha minima de 8 caracteres e paginas legais publicas (privacidade, segurança, cookies, termos e aviso de atendimento automatizado).",
        ],
      },
    ],
  },
];
