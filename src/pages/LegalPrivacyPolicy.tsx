import LegalPageLayout from "@/components/legal/LegalPageLayout";

const LegalPrivacyPolicy = () => {
  return (
    <LegalPageLayout
      title="Política de Privacidade"
      version="1.0"
      updatedAt="19 de março de 2026"
      intro={[
        "A DNIA AI é uma empresa brasileira que desenvolve e opera plataformas de atendimento automatizado com inteligência artificial (IA), incluindo chatbots conversacionais, sistemas de CRM e integração com canais de comunicação como o WhatsApp.",
        "Encarregado de Proteção de Dados (DPO): Rodrigo Nascimento | E-mail: rodrigo@dnia.ai",
        "Esta Política de Privacidade descreve como a DNIA AI coleta, usa, armazena e protege os dados pessoais dos usuários que interagem com os serviços prestados por meio de nossa plataforma, em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018). Ao interagir com qualquer serviço operado pela DNIA AI, incluindo atendimento via WhatsApp, você concorda com os termos desta Política.",
      ]}
      sections={[
        {
          title: "Quem somos",
          paragraphs: [
            "A DNIA AI desenvolve e opera soluções de atendimento automatizado para empresas, com foco em conversas inteligentes, gestão de relacionamento e integração com canais digitais.",
          ],
        },
        {
          title: "Quais dados coletamos",
          paragraphs: ["Coletamos apenas os dados estritamente necessários para a prestação do serviço contratado:"],
          list: [
            "Identificação: nome e número de telefone, para identificação do usuário no atendimento.",
            "Comunicação: histórico de mensagens via WhatsApp, para prestação do serviço de atendimento.",
            "Dados de uso: interações com o chatbot e intenções identificadas, para melhoria do serviço.",
            "Dados de contato: e-mail, quando fornecido, para comunicação e suporte.",
            "Não coletamos dados sensíveis (saúde, origem racial, convicções religiosas, dados biométricos ou financeiros) no contexto do atendimento automatizado.",
          ],
        },
        {
          title: "Como usamos seus dados",
          paragraphs: ["Os dados coletados são utilizados exclusivamente para:"],
          list: [
            "Prestar o serviço de atendimento automatizado contratado pela empresa parceira.",
            "Responder dúvidas sobre produtos e serviços.",
            "Direcionar o usuário para a finalização de compras ou suporte adequado.",
            "Melhorar a qualidade do atendimento e da plataforma.",
            "Cumprir obrigações legais e regulatórias.",
            "Seus dados nunca serão vendidos, alugados ou compartilhados com terceiros para fins de marketing sem seu consentimento explícito.",
          ],
        },
        {
          title: "Base legal para o tratamento",
          list: [
            "Execução de contrato (art. 7º, V da LGPD): quando o tratamento é necessário para a prestação do serviço solicitado.",
            "Legítimo interesse (art. 7º, IX): para melhoria do serviço, segurança e prevenção de fraudes.",
            "Cumprimento de obrigação legal (art. 7º, II): quando exigido por lei ou regulamento.",
          ],
        },
        {
          title: "Decisões automatizadas",
          paragraphs: [
            "A DNIA AI não realiza tomada de decisão automatizada com efeitos jurídicos sobre os titulares, criação de perfis (profiling) ou análise preditiva de dados pessoais. O sistema de atendimento via chatbot opera exclusivamente para responder dúvidas e direcionar o usuário, sem produzir decisões que afetem direitos ou interesses dos titulares.",
          ],
        },
        {
          title: "Registro de Atividades de Tratamento",
          paragraphs: [
            "Em conformidade com o art. 37 da LGPD, a DNIA AI mantém registro das operações de tratamento de dados pessoais realizadas em sua plataforma:",
          ],
          list: [
            "Finalidade: atendimento automatizado via WhatsApp.",
            "Dados tratados: nome, telefone e histórico de mensagens.",
            "Base legal: execução de contrato (art. 7º, V da LGPD) e legítimo interesse (art. 7º, IX da LGPD).",
            "Tempo de retenção: até 90 (noventa) dias após o encerramento do contrato.",
            "Responsável: DNIA AI / DPO Rodrigo Nascimento (rodrigo@dnia.ai).",
          ],
        },
        {
          title: "Compartilhamento de dados",
          paragraphs: ["A DNIA AI pode compartilhar dados pessoais com:"],
          list: [
            "Empresa contratante (ex.: Multilaser), para prestação do serviço contratado.",
            <>
              <span>Supabase (banco de dados em nuvem), para armazenamento seguro dos dados.</span>
              <div className="mt-1 text-xs">
                <a href="https://supabase.com/terms" target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: "var(--accent-ink)" }}>Termos de Serviço</a>
                <span className="text-muted-foreground"> · </span>
                <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: "var(--accent-ink)" }}>Política de Privacidade</a>
              </div>
            </>,
            <>
              <span>Google Workspace, para e-mail corporativo e comunicações.</span>
              <div className="mt-1 text-xs">
                <a href="https://workspace.google.com/terms/standard_terms.html" target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: "var(--accent-ink)" }}>Termos de Serviço</a>
                <span className="text-muted-foreground"> · </span>
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: "var(--accent-ink)" }}>Política de Privacidade</a>
              </div>
            </>,
            <>
              <span>Meta / WhatsApp, canal de comunicação com o usuário e integrações via API oficial.</span>
              <div className="mt-1 text-xs">
                <a href="https://developers.facebook.com/terms" target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: "var(--accent-ink)" }}>Termos da Plataforma</a>
                <span className="text-muted-foreground"> · </span>
                <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer" className="no-underline hover:underline" style={{ color: "var(--accent-ink)" }}>Política de Privacidade</a>
              </div>
            </>,
            "Todos os fornecedores são selecionados com base em critérios de segurança e possuem comprometimento contratual com a proteção de dados.",
          ],
        },
        {
          title: "Transferência Internacional de Dados",
          paragraphs: [
            "A DNIA AI não realiza transferência internacional de dados pessoais. Todos os dados são armazenados e processados em território brasileiro ou em servidores de provedores que garantem nível adequado de proteção de dados conforme a LGPD. Caso futuramente haja necessidade de transferência internacional, esta será realizada com base nas hipóteses previstas no art. 33 da LGPD, e a presente Política será atualizada para refletir essa alteração.",
          ],
        },
        {
          title: "Segurança dos dados",
          list: [
            "Controle de acesso baseado em perfis (roles) com Row Level Security (RLS) no banco de dados.",
            "Criptografia de credenciais sensíveis com AES-GCM + PBKDF2.",
            "Isolamento de dados por workspace (arquitetura multi-tenant).",
            "Comunicação cifrada via HTTPS/TLS em todas as transmissões.",
            "Autenticação segura gerenciada pelo Supabase Auth.",
            "Infraestrutura em nuvem por provedores certificados (Supabase Cloud — SOC 2 Type II).",
          ],
        },
        {
          title: "Retenção dos dados",
          paragraphs: [
            "Os dados pessoais coletados são retidos pelo período necessário à prestação do serviço contratado. Após o encerramento do contrato, os dados são excluídos em até 90 (noventa) dias, salvo obrigação legal de retenção por prazo superior. A exclusão contempla todos os registros do banco de dados (leads, contatos, mensagens e histórico de conversas), realizada em cascata. As cópias de segurança (backups) são automaticamente excluídas pelo provedor (Supabase) após 7 (sete) dias. Dados necessários ao cumprimento de obrigações legais (ex.: registros fiscais, logs de acesso) são retidos conforme os prazos estabelecidos pela legislação aplicável.",
          ],
        },
        {
          title: "Direitos do titular",
          paragraphs: ["Como titular de dados pessoais, você tem os seguintes direitos, garantidos pela LGPD:"],
          list: [
            "Confirmação e acesso: confirmar a existência e acessar seus dados.",
            "Correção: solicitar a correção de dados incompletos, inexatos ou desatualizados.",
            "Anonimização, bloqueio ou eliminação: solicitar a anonimização ou eliminação de dados desnecessários.",
            "Portabilidade: receber seus dados em formato estruturado.",
            "Eliminação: solicitar a eliminação de dados tratados com base em consentimento.",
            "Informação: obter informações sobre compartilhamento com terceiros.",
            "Revogação do consentimento: revogar o consentimento a qualquer momento.",
            "Para exercer seus direitos, entre em contato pelo e-mail: suporte@dnia.ai. As solicitações serão respondidas em até 15 (quinze) dias úteis, conforme prazo estabelecido pela LGPD.",
          ],
        },
        {
          title: "Segurança da informação",
          paragraphs: [
            "A DNIA AI adota medidas técnicas e organizacionais para proteger seus dados pessoais contra acesso não autorizado, perda, alteração ou divulgação indevida, incluindo: criptografia AES-GCM + PBKDF2 para dados sensíveis; controle de acesso baseado em perfis (RBAC) com Row Level Security (RLS); comunicação cifrada via HTTPS/TLS; autenticação gerenciada pelo Supabase Auth; e monitoramento contínuo de segurança.",
          ],
        },
        {
          title: "Contato e DPO",
          list: [
            "Encarregado de Proteção de Dados (DPO): Rodrigo Nascimento.",
            "E-mail: rodrigo@dnia.ai.",
            "Suporte geral: suporte@dnia.ai.",
            "Site: dnia.ai.",
          ],
        },
      ]}
      footer={[
        "DNIA AI — todos os direitos reservados | Atualizado em março de 2026",
      ]}
    />
  );
};

export default LegalPrivacyPolicy;
