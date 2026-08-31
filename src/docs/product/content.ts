import type { DocSection, ProductDoc } from "./types";
import { agentsSections } from "./sections/agents";
import { crmSections } from "./sections/crm";
import { platformSections } from "./sections/platform";

const overview: DocSection = {
  id: "visao-geral",
  number: "1",
  title: "Visão Geral",
  summary: "O que é o Nexus AI e como os módulos se conectam.",
  blocks: [
    {
      type: "paragraph",
      text: "O Nexus AI é a plataforma de atendimento e vendas com agentes de inteligência artificial da dn.ia. Ela une, em um único lugar, a conversa com o cliente (WhatsApp e widgets), a inteligência que responde e qualifica, o CRM que organiza a oportunidade, a agenda que marca a reunião e os relatórios que medem o resultado do time.",
    },
    { type: "subheading", text: "Proposta de valor" },
    {
      type: "list",
      items: [
        "Atendimento continuo — agentes de IA respondem em português, com o conhecimento da empresa e passagem natural para o humano.",
        "Funil vivo — cada conversa vira contato, card e atividade, sem digitação manual.",
        "Agenda automática — a IA e o widget público marcam reuniões respeitando a disponibilidade real do time.",
        "Gestão por evidência — reuniões e ligações são transcritas e avaliadas contra o playbook da empresa.",
        "Extensibilidade — API REST completa, webhooks e integrações de marketing e telefonia.",
      ],
    },
    { type: "subheading", text: "Como os módulos se conectam" },
    {
      type: "table",
      headers: ["Camada", "Módulos"],
      rows: [
        ["Conversa", "Chat ao vivo (Inbox), Conexões e canais, Widgets de chat"],
        ["Inteligência", "Agentes, Orquestrador de IA, Base de conhecimento"],
        [
          "Comercial",
          "Contatos, Pipeline, Atividades, Cadências, Auto move, Análise psicológica, Catálogos",
        ],
        ["Agenda", "Agendamentos, Reuniões por vídeo, gravação e transcrição"],
        ["Gestão", "Desempenho por playbook, Analytics e relatórios"],
        ["Plataforma", "API pública, Multi-tenancy e permissões, Privacidade e LGPD"],
      ],
    },
    { type: "subheading", text: "Stack tecnológica" },
    {
      type: "table",
      headers: ["Camada", "Tecnologia"],
      rows: [
        ["Frontend", "React 18, TypeScript, Vite"],
        ["Estilo", "Tailwind CSS, shadcn/ui, design system dark com efeito glass"],
        ["Backend", "Banco Postgres gerenciado com segurança por linha (RLS) e funções serverless"],
        ["IA", "Modelos Gemini e OpenAI para conversa, análise, embeddings e transcrição"],
        ["Canais", "Z-API, WhatsApp Oficial (Meta), Google Calendar, Daily.co, Api4com"],
      ],
    },
    {
      type: "note",
      text: "Convenções gerais: interface e comunicação em português do Brasil, datas e horários no fuso America/São_Paulo (UTC-3) e isolamento de dados por workspace em todas as consultas.",
    },
  ],
};

export const productDoc: ProductDoc = {
  title: "Documentação de Recursos — Nexus AI",
  subtitle: "Mapa completo da plataforma: recursos, funcionamento interno e regras de negócio",
  version: "1.0.0",
  updatedAt: "11/08/2026 15:45 (Brasilia)",
  sections: [overview, ...agentsSections, ...crmSections, ...platformSections].sort(
    (a, b) => Number(a.number) - Number(b.number),
  ),
};
