import LegalPageLayout from "@/components/legal/LegalPageLayout";

const LegalTermsOfUse = () => {
  return (
    <LegalPageLayout
      title="Termos de Uso"
      version="1.0"
      updatedAt="março de 2026"
      intro={[
        "DNIA AI — Nexus Platform",
      ]}
      sections={[
        {
          title: "Aceitação dos termos",
          paragraphs: [
            "Ao acessar ou utilizar a plataforma Nexus da DNIA AI, você concorda com estes Termos de Uso. Caso não concorde, não utilize a plataforma.",
          ],
        },
        {
          title: "Descrição do serviço",
          paragraphs: [
            "A DNIA AI oferece a plataforma Nexus, um sistema de gestão de atendimento automatizado via WhatsApp com inteligência artificial, destinado a empresas que desejam automatizar o relacionamento com seus clientes para fins de vendas, suporte e engajamento.",
          ],
        },
        {
          title: "Cadastro e acesso",
          list: [
            "O acesso à plataforma requer cadastro prévio e aprovação pela DNIA AI.",
            "O usuário é responsável pela confidencialidade de suas credenciais de acesso.",
            "O compartilhamento de credenciais é expressamente proibido.",
            "A DNIA AI pode suspender ou encerrar o acesso em caso de uso indevido.",
          ],
        },
        {
          title: "Uso permitido",
          paragraphs: [
            "O usuário se compromete a utilizar a plataforma exclusivamente para finalidades lícitas e em conformidade com estes termos, a legislação brasileira e as políticas do WhatsApp Business.",
          ],
        },
        {
          title: "Uso proibido",
          paragraphs: ["É vedado ao usuário:"],
          list: [
            "Usar a plataforma para envio de spam ou comunicações não solicitadas.",
            "Realizar engenharia reversa, copiar ou distribuir o software.",
            "Usar a plataforma para fins ilegais, fraudulentos ou que violem direitos de terceiros.",
            "Tentar acessar sistemas, dados ou contas de outros usuários sem autorização.",
          ],
        },
        {
          title: "Propriedade intelectual",
          paragraphs: [
            "Todos os direitos sobre a plataforma Nexus, incluindo software, design, marca e documentação, pertencem à DNIA AI. É proibida a reprodução, distribuição ou modificação sem autorização prévia e por escrito.",
          ],
        },
        {
          title: "Limitação de responsabilidade",
          paragraphs: ["A DNIA AI não se responsabiliza por:"],
          list: [
            "Danos decorrentes de uso inadequado da plataforma pelo usuário.",
            "Interrupções de serviço causadas por fatores externos (infraestrutura de terceiros, caso fortuito ou força maior).",
            "Conteúdo inserido pelo usuário ou pela empresa contratante na base de conhecimento do chatbot.",
            "Decisões tomadas com base nas respostas do assistente virtual.",
          ],
        },
        {
          title: "Disponibilidade do serviço",
          paragraphs: [
            "A DNIA AI empreende esforços para garantir a disponibilidade contínua da plataforma, mas não garante disponibilidade ininterrupta. Manutenções programadas serão comunicadas com antecedência sempre que possível.",
          ],
        },
        {
          title: "Privacidade e proteção de dados",
          paragraphs: [
            "O tratamento de dados pessoais na plataforma é regido pela Política de Privacidade da DNIA AI, disponível em nexus.dnia.ai/legal/politica-de-privacidade, em conformidade com a LGPD (Lei nº 13.709/2018). Todos os colaboradores e prestadores de serviços da DNIA AI assinam Acordo de Confidencialidade (NDA) e Termo de Uso e Segurança de Dados como condição para início das atividades. Terceiros envolvidos no processamento de dados em nome da DNIA AI recebem orientações sobre as práticas de proteção de dados adotadas, incluindo restrição de uso dos dados ao escopo do serviço, obrigação de confidencialidade e procedimentos para reporte de incidentes.",
          ],
        },
        {
          title: "Alterações nos termos",
          paragraphs: [
            "A DNIA AI reserva-se o direito de alterar estes Termos de Uso a qualquer momento. Alterações significativas serão comunicadas com antecedência mínima de 15 dias. O uso continuado da plataforma após as alterações constitui aceitação dos novos termos.",
          ],
        },
        {
          title: "Rescisão",
          paragraphs: [
            "Qualquer parte pode encerrar o uso da plataforma mediante aviso prévio conforme contrato vigente. Em caso de violação destes termos, a DNIA AI pode suspender ou encerrar o acesso imediatamente.",
          ],
        },
        {
          title: "Foro",
          paragraphs: [
            "Fica eleito o foro da comarca de Belo Horizonte, Estado de Minas Gerais, para dirimir quaisquer controvérsias decorrentes destes Termos de Uso, com renúncia expressa a qualquer outro, por mais privilegiado que seja.",
          ],
        },
        {
          title: "Contato",
          paragraphs: [
            "DNIA AI | E-mail: suporte@dnia.ai | DPO: rodrigo@dnia.ai | Site: dnia.ai",
          ],
        },
      ]}
      footer={[
        "DNIA AI — todos os direitos reservados | Atualizado em março de 2026",
      ]}
    />
  );
};

export default LegalTermsOfUse;
