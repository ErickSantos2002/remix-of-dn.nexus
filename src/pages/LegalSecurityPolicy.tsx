import LegalPageLayout from "@/components/legal/LegalPageLayout";

const LegalSecurityPolicy = () => {
  return (
    <LegalPageLayout
      title="Política de Segurança da Informação"
      version="1.0"
      updatedAt="março de 2026"
      intro={[
        "DNIA AI — Nexus Platform",
      ]}
      sections={[
        {
          title: "Objetivo",
          paragraphs: [
            "Esta Política de Segurança da Informação tem por objetivo estabelecer diretrizes, responsabilidades e controles para proteger as informações tratadas pela DNIA AI, garantindo confidencialidade, integridade e disponibilidade dos dados, em conformidade com a Lei nº 13.709/2018 (LGPD) e demais normas aplicáveis.",
          ],
        },
        {
          title: "Escopo",
          paragraphs: [
            "Esta política aplica-se a todos os colaboradores, parceiros, prestadores de serviço e sistemas que tratem informações da DNIA AI ou de seus clientes, incluindo a plataforma Nexus e o canal de atendimento via WhatsApp.",
          ],
        },
        {
          title: "Classificação da informação",
          paragraphs: ["As informações são classificadas em:"],
          list: [
            "Pública: informações disponíveis ao público sem restrições.",
            "Interna: informações para uso interno, não destinadas ao público.",
            "Confidencial: informações sensíveis de clientes, parceiros ou operações. Acesso restrito.",
            "Restrita: credenciais, chaves de API, dados de autenticação. Acesso mínimo necessário.",
          ],
        },
        {
          title: "Controles de acesso",
          list: [
            "Autenticação gerenciada pelo Supabase Auth com suporte a MFA.",
            "Controle de acesso baseado em perfis (RBAC): super_admin, admin, member.",
            "Row Level Security (RLS) no banco de dados para isolamento de dados por workspace.",
            "Princípio do menor privilégio: cada colaborador acessa apenas o necessário.",
            "Revisão periódica de acessos e revogação imediata em caso de desligamento.",
            "Política de senhas: mínimo de 8 caracteres com complexidade exigida pelo Supabase Auth.",
            "Tokens de sessão JWT com tempo de expiração configurado.",
            "Revogação de acesso realizada imediatamente pelo administrador via painel de gestão de usuários, com bloqueio aplicado em nível de banco de dados pelas políticas de RLS.",
            "Colaboradores e contratados são instruídos a não armazenar dados pessoais de clientes em dispositivos pessoais ou de armazenamento móvel. O acesso deve ser realizado exclusivamente via sistemas autorizados pela empresa (plataforma Nexus AI via navegador).",
          ],
        },
        {
          title: "Criptografia",
          list: [
            "Credenciais e dados sensíveis criptografados com AES-GCM + PBKDF2.",
            "Todas as comunicações via HTTPS/TLS 1.2+.",
            "Tokens e chaves de API armazenados de forma segura (variáveis de ambiente, nunca em código-fonte).",
          ],
        },
        {
          title: "Gestão de incidentes",
          paragraphs: ["Em caso de incidente de segurança:"],
          list: [
            "Identificação e contenção imediata.",
            "Avaliação do impacto e dados afetados.",
            "Notificação ao responsável pelo workspace/cliente em até 24 horas.",
            "Notificação à ANPD conforme prazo legal (2 dias úteis para incidentes graves).",
            "Registro e documentação para análise de causa raiz.",
            "Canal de reporte: suporte@dnia.ai.",
          ],
        },
        {
          title: "Avaliação de Impacto (RIPD)",
          paragraphs: [
            "A necessidade de Relatório de Impacto à Proteção de Dados Pessoais (RIPD) é avaliada caso a caso antes do início de novos tratamentos. Para o escopo atual (atendimento automatizado via chatbot de baixo risco), não há obrigatoriedade de RIPD, pois o processamento não envolve decisões automatizadas com efeitos jurídicos, dados sensíveis ou tratamento em larga escala de dados especiais. Tratamentos de maior risco serão precedidos de RIPD formal.",
          ],
        },
        {
          title: "Desenvolvimento seguro",
          list: [
            "Revisão de código com foco em segurança antes de cada deploy.",
            "Variáveis de ambiente para credenciais (nunca hardcoded).",
            "Uso de Row Level Security em todas as tabelas com dados de usuários.",
            "Testes de segurança periódicos e validação de dependências.",
            "Ambientes separados de desenvolvimento (local via Vite) e produção (Lovable Cloud), com deploy automatizado exclusivamente via pipeline na branch principal.",
            "Revalidação de código (code review e lint check via ESLint) realizada a cada ciclo de desenvolvimento, antes de cada push na branch principal.",
          ],
        },
        {
          title: "Fornecedores e terceiros",
          paragraphs: ["Todos os fornecedores são avaliados quanto a práticas de segurança."],
          list: [
            "Supabase Cloud (SOC 2 Type II): banco de dados e autenticação.",
            "Google Workspace: e-mail corporativo com proteções antiphishing, antispam e 2FA.",
            "Meta/WhatsApp Business API: canal de comunicação com usuários finais.",
            "Contratos incluem cláusulas de confidencialidade e proteção de dados.",
          ],
        },
        {
          title: "Infraestrutura e hardening",
          paragraphs: [
            "A DNIA AI não gerencia servidores físicos ou virtuais próprios. O hardening e o baseline dos servidores subjacentes são responsabilidade dos provedores de nuvem (Supabase Cloud e Lovable Cloud), que seguem as melhores práticas de segurança de seus respectivos ambientes e possuem certificação SOC 2 Type II.",
          ],
        },
        {
          title: "Disponibilidade e monitoramento",
          paragraphs: [
            "O sistema conta com monitoramento automatizado de disponibilidade via health check executado a cada 5 minutos (função pg_cron), monitorando o status de todas as conexões ativas e atualizando os indicadores em tempo real. O banco de dados opera com realtime subscriptions para monitoramento de eventos. A disponibilidade da infraestrutura de nuvem é monitorada pelos provedores (Supabase e Lovable Cloud).",
          ],
        },
        {
          title: "Treinamento e conscientização",
          paragraphs: [
            "Todos os colaboradores e prestadores de serviços assinam Acordo de Confidencialidade (NDA) e Termo de Uso e Segurança de Dados como condição para início das atividades. Os colaboradores recebem orientações sobre boas práticas de privacidade e segurança da informação durante o onboarding e ao longo dos projetos. A empresa está estruturando um programa formal de conscientização em proteção de dados, com treinamentos periódicos documentados, previsto no roadmap de conformidade. Internamente, são realizadas revisões periódicas de conformidade de segurança (controle de acessos, RLS, cookies, revisão de código), com registro de data, responsável e itens revisados. Política de mesa limpa e bloqueio de tela obrigatório.",
          ],
        },
        {
          title: "Vigência e revisão",
          paragraphs: [
            "Esta política entra em vigor na data de sua publicação e deve ser revisada anualmente ou sempre que ocorrerem mudanças relevantes nos processos, sistemas ou legislação aplicável.",
          ],
        },
      ]}
      footer={[
        "DPO: Rodrigo Nascimento | rodrigo@dnia.ai",
        "DNIA AI | suporte@dnia.ai | dnia.ai",
      ]}
    />
  );
};

export default LegalSecurityPolicy;
