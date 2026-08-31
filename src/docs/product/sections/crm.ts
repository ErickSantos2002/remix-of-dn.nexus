import type { DocSection } from "../types";

export const crmSections: DocSection[] = [
  {
    id: "contatos",
    number: "7",
    title: "Contatos",
    summary:
      "Cadastro central de pessoas e empresas, compartilhado entre os workspaces da mesma empresa, com tags, origem, opt-out e importação/exportação.",
    blocks: [
      { type: "subheading", text: "O que é" },
      {
        type: "paragraph",
        text: "O contato guarda a identidade da pessoa (nome, telefone, e-mail, empresa, cargo, faturamento, número de funcionários), a origem do primeiro contato, as tags e as preferências de comunicação. Os cards do funil sempre apontam para um contato.",
      },
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Recurso", "Como funciona"],
        rows: [
          [
            "Escopo",
            "Contatos são únicos no escopo da empresa (deduplicados por telefone/e-mail entre todos os workspaces); cards pertencem ao workspace.",
          ],
          [
            "Telefone",
            "Normalizado para somente digitos com DDI 55; números antigos de 8 digitos recebem o nono digito. A exibicao formatada é apenas visual.",
          ],
          [
            "Tags",
            "Lista com nome e cor, com sugestao automática das tags já usadas no workspace e pagina de gestão em /crm/settings/tags.",
          ],
          [
            "Origem",
            "Catálogo por empresa (crm_contact_sources). Gravada uma única vez, na criação — atribuição de primeiro toque.",
          ],
          [
            "Não Perturbe (opt-out)",
            "Bloqueia envios automáticos ao contato e fica disponível como filtro.",
          ],
          [
            "Importação",
            "Assistente em 5 etapas com validação de colunas, obrigatórios, duplicados no arquivo e na base, escolha entre ignorar ou sobrescrever e tag comum opcional.",
          ],
          [
            "Exportação",
            "CSV com separador ponto e virgula e BOM UTF-8; permitido a owner, admin e super admin.",
          ],
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "GET /crm/contacts (busca por nome, telefone ou e-mail; filtro por origem; paginado), GET/PUT/DELETE /crm/contacts/{id} (exclusão lógica).",
          "POST /crm/contacts — criação não destrutiva: preenche apenas campos vazios e reativa contato inativo.",
          "POST /crm/contacts/upsert — idempotente por telefone/e-mail em toda a empresa; campos enviados sobrescrevem, omitidos são preservados.",
          "POST /crm/contacts/import, GET /crm/contacts/export, POST /crm/contacts/backfill.",
          "PUT /crm/contacts/{id}/tags e PUT /crm/contacts/{id}/opt-out.",
          "GET/PUT /crm/tags e GET /crm/contact-sources.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "A origem do contato e imutavel após a primeira gravação.",
          "Ao reconciliar duplicados, o card aberto mais antigo do contato duplicado e reapontado para o contato vencedor, desde que este ainda não tenha card aberto.",
          "Exclusão é sempre lógica (is_active = false), preservando histórico.",
          "Contato inativo volta a ficar ativo quando envia uma nova mensagem.",
        ],
      },
    ],
  },
  {
    id: "pipeline",
    number: "8",
    title: "Pipeline / Funil de vendas",
    summary:
      "Kanban de oportunidades por etapa, com histórico completo de movimentação, valores, produtos, ganhos e perdas.",
    blocks: [
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Tabela", "Papel", "Campos-chave"],
        rows: [
          [
            "crm_pipeline_stages",
            "Etapas do funil",
            "name, cor, ordem, is_default, alerta e perigo por horas na etapa (SLA visual), evento Meta associado",
          ],
          [
            "crm_leads",
            "Card / oportunidade",
            "stage_id, contact_id, status (open/won/lost), value, product_id, segment_id, loss_reason_id, assigned_to, moved_at, closed_at, UTMs, exclusão lógica",
          ],
          [
            "crm_lead_history",
            "Linha do tempo do card",
            "ação, etapa de origem e destino, autor, motivo e notas",
          ],
        ],
      },
      { type: "subheading", text: "Recursos" },
      {
        type: "list",
        items: [
          "Arrastar e soltar entre etapas, com indicadores visuais de tempo parado na etapa.",
          "Filtros por status, produto, responsável e tags, memorizados por usuário e workspace.",
          "Exportação CSV dos cards visíveis com dados de contato, origem, UTMs, tags e responsável.",
          "Link direto para um card via ?lead=ID.",
          "Criação manual de card a partir da lista de contatos.",
          "Campo Canal exibido no card (equivalente ao utm_source) além dos demais UTMs.",
        ],
      },
      { type: "subheading", text: "Endpoints da API" },
      {
        type: "list",
        items: [
          "CRUD de etapas: GET/POST /crm/pipeline/stages, PUT /crm/pipeline/stages/reorder, PUT/DELETE por id.",
          "GET /crm/pipeline/stages/{id}/leads — modo atual (snapshot) ou período (via histórico).",
          "GET/POST /crm/leads, PUT /crm/leads/{id}, PUT /crm/leads/{id}/stage, POST /crm/leads/upsert.",
          "GET /crm/leads/{id}/history, GET/PATCH /crm/leads/{id}/utm.",
          "GET /crm/funnel/stats — funil completo com contagem atual, entradas no período e conversão entre etapas; aceita assigned_to para recortar por vendedor.",
          "GET /analytics/funnel-by-seller (alias /analytics/sellers) — mesmo funil quebrado por vendedor, com contagem por etapa, taxas Lead→MQL→SQL→Venda, ganhos, perdas, valor e ciclo médio.",
          "GET /analytics/agents — desempenho comercial por vendedor com etapas e taxas; ?source=ai retorna o formato antigo por agente de IA.",
          "GET /analytics/cohort — coortes mensais; aceita assigned_to, utm_source e utm_campaign.",
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Um único card aberto por contato por workspace.",
          "Movimentação sequencial: na interface, o card só pode avançar ou voltar uma etapa por vez.",
          "Ganho e perda alteram o status e a data de fechamento, mas o card permanece na etapa em que estava; por isso os relatórios de ganhos usam o histórico (closed_won / closed_lost) com fallback no status e na data de fechamento.",
          "Relatórios por vendedor usam o dono atual do card (assigned_to): trocar o responsável reatribui o histórico daquele card retroativamente.",
          "Perda exige motivo do catálogo; motivos podem ser restritos a determinadas etapas.",
          "Mover novamente um card fechado o reabre automaticamente, limpando status, data de fechamento e motivo de perda, com registro no histórico.",
          "Título do card = empresa quando existir, senao o nome do contato; sincronizado automaticamente.",
          "Mudancas de etapa disparam integrações externas (Meta Conversions API e dn.marketing) quando configuradas.",
          "Cards excluidos são mantidos com exclusão lógica e ignorados nos relatórios.",
        ],
      },
    ],
  },
  {
    id: "atividades",
    number: "9",
    title: "Atividades e follow-ups",
    summary:
      "Tarefas, ligações e reuniões vinculadas ao card, com responsável, prazo, conclusão e análise de atendimento.",
    blocks: [
      {
        type: "list",
        items: [
          "Cada atividade tem tipo, título, descrição, data agendada, status, responsável, duração e motivo de no-show.",
          "Pode estar vinculada a um agendamento da agenda, a uma ligação VoIP e a um playbook de análise.",
          "Cancelar ou concluir uma atividade interrompe as mensagens pendentes da régua associada.",
          "Excluir uma atividade ligada a um agendamento desvincula antes de excluir, liberando o horário e preservando a trilha de auditoria.",
          "Lembretes chegam pelo sino de notificações e por alertas do navegador.",
          "Super admin pode alterar o responsável pela atividade no modal de detalhe.",
          "Endpoints: GET/POST /crm/leads/{id}/activities e PUT /crm/leads/{id}/activities/{activityId}.",
        ],
      },
    ],
  },
  {
    id: "cadências",
    number: "10",
    title: "Cadências (réguas de relacionamento)",
    summary:
      "Sequencias automáticas de mensagens por WhatsApp ou e-mail, disparadas por entrada em etapa ou por tipo de atividade.",
    blocks: [
      { type: "subheading", text: "Funcionamento interno" },
      {
        type: "table",
        headers: ["Tabela", "Papel"],
        rows: [
          [
            "cadence_rules",
            "Regra da régua, no escopo da empresa: gatilho por etapa (stage) ou por atividade (activity) e status ativo.",
          ],
          [
            "cadence_templates",
            "Passos da régua: ordem, atraso (valor + unidade), período do dia, canal, conteúdo, modelo HSM, midia, agente e reescrita por IA.",
          ],
          [
            "cadence_scheduled_messages",
            "Fila de disparo: lead, regra, passo, canal, horário de envio, status, erro e vínculo com a mensagem enviada.",
          ],
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Cada disparo recebe um jitter de até poucos minutos para evitar padrão robotico e reduzir risco de bloqueio.",
          "Mensagens são canceladas automaticamente quando a atividade e cancelada/concluída ou quando o lead e fechado.",
          "Contatos com Não Perturbe e janela de envio da empresa são respeitados.",
          "Reescrita opcional por IA preserva links, variaveis e porcentagens do texto original.",
          "Nos relatórios, mensagens puladas ou canceladas não entram na análise; falhas técnicas de envio são contabilizadas a parte.",
          "A entrega e apurada pelo status real da mensagem no canal, e não apenas pelo envio.",
        ],
      },
      { type: "subheading", text: "Relatórios" },
      {
        type: "list",
        items: [
          "Estatísticas por régua e estatísticas gerais por tipo de régua (atividade ou etapa).",
          "Filtro temporal com período personalizado e comparacao com o período anterior.",
          "Métricas: réguas iniciadas, leads distintos ativados, mensagens enviadas, entregues, lidas, falhas técnicas e atividades vinculadas (em aberto, vencidas, concluidas).",
          "Endpoints: GET /cadences/summary, GET /cadences/rules e GET /cadences/rules/{id}.",
        ],
      },
    ],
  },
  {
    id: "auto-move",
    number: "11",
    title: "Auto move (movimentação automática de cards)",
    summary:
      "Regras que movem o card de etapa automaticamente conforme os scores da análise psicológica do lead.",
    blocks: [
      { type: "subheading", text: "Como funciona" },
      {
        type: "list",
        items: [
          "Cada regra define condição (propensão, risco, oportunidade, temperatura ou lead score), operador, valor, etapa de origem opcional e etapa de destino.",
          "As regras são avaliadas por prioridade decrescente no momento em que a análise psicológica do lead é concluída.",
          "Se a condição for satisfeita e o card estiver na etapa de origem (ou a regra valer para qualquer etapa), o card é movido.",
          "Cada movimento gera registro em crm_automove_log (com a foto dos scores usados) e também no histórico do card.",
          "Workspaces novos recebem um conjunto padrão de regras.",
          "Endpoints: CRUD em /crm/automove/rules e consulta paginada de /crm/automove/log.",
        ],
      },
      {
        type: "note",
        text: "O auto move não roda em segundo plano de forma contínua: ele é avaliado sempre que uma nova análise psicológica do lead é gerada.",
      },
    ],
  },
  {
    id: "psicologia",
    number: "12",
    title: "Análise psicológica do lead (DNIA)",
    summary:
      "Leitura por IA do comportamento do lead em 6 dimensões, com código DNA, scores, temperatura e estratégia de venda.",
    blocks: [
      {
        type: "list",
        items: [
          "Dimensões avaliadas de 0 a 5: inteligência, investimento, intenção, engajamento, potencial e decisão.",
          "Saídas: código DNA, propensão, risco e oportunidade (0 a 100) e temperatura (muito quente, quente, morno, frio).",
          "Arqueologia emocional: palavras-chave, principais dores e desejos, processo de decisão e padrões de autossabotagem.",
          "Gera também texto de análise, insights, estratégia de venda e playbook de abordagem, com as fontes utilizadas.",
          "Transcrições de áudio são tratadas como falas diretas do lead na análise.",
          "A análise é bloqueada para leads com menos de 2 mensagens, para não gerar conclusão sem dados reais.",
          "Endpoints: GET /crm/leads/{id}/psychology e POST /crm/leads/{id}/psychology/analyze.",
        ],
      },
    ],
  },
  {
    id: "catálogos",
    number: "13",
    title: "Catálogos do CRM",
    summary:
      "Listas configuraveis que padronizam os dados dos cards: produtos, motivos de perda, segmentos, dores, objeções e origens.",
    blocks: [
      {
        type: "table",
        headers: ["Catálogo", "Escopo", "Uso"],
        rows: [
          ["Produtos", "Workspace", "Produto do card e valor associado."],
          [
            "Motivos de perda",
            "Workspace",
            "Obrigatório ao marcar o card como perdido; pode ser restrito por etapa. Configurado apenas em /settings/company.",
          ],
          [
            "Segmentos",
            "Workspace",
            "Valor único por card, com segmento padrão usado como fallback da API.",
          ],
          [
            "Dores e objeções",
            "Workspace",
            "Múltipla seleção por card, alimentam o relatório de dores e objeções.",
          ],
          [
            "Origens do lead",
            "Empresa",
            "Define a origem valida dos contatos; origens do sistema não podem ser removidas.",
          ],
        ],
      },
      { type: "subheading", text: "Regras de negócio" },
      {
        type: "list",
        items: [
          "Cada bloco (segmentos, dores, objeções) pode ser ligado ou desligado na tela do card; a ausencia de configuração significa ativo.",
          "Validação não bloqueante na API: valor de origem desconhecido vira 'Não identificado' e segmento desconhecido cai no padrão, sempre com aviso na resposta — nenhuma integração perde lead por um valor digitado errado.",
          "Um único segmento pode ser marcado como padrão por workspace.",
        ],
      },
    ],
  },
];
