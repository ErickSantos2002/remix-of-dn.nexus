import LegalPageLayout from "@/components/legal/LegalPageLayout";

const LegalAutomatedServiceNotice = () => {
  return (
    <LegalPageLayout
      title="Aviso de Atendimento Automatizado (IA)"
      version="1.0"
      updatedAt="março de 2026"
      intro={[
        "DNIA AI — Nexus Platform",
        "Prezado(a) usuário(a),",
        "Você está sendo atendido(a) por um assistente virtual com inteligência artificial (IA), desenvolvido e operado pela DNIA AI em parceria com a empresa contratante do serviço.",
      ]}
      sections={[
        {
          title: "Sobre o atendimento automatizado",
          list: [
            "Este chatbot opera exclusivamente via canal WhatsApp.",
            "O assistente é projetado para responder dúvidas sobre produtos, apresentar informações e direcionar para links de compra ou carrinho.",
            "As respostas são geradas automaticamente com base em modelos de linguagem (LLM) e na base de conhecimento configurada pela empresa parceira.",
          ],
        },
        {
          title: "Dados coletados neste atendimento",
          list: [
            "Nome e número de telefone (identificação no WhatsApp).",
            "Histórico de mensagens da conversa.",
            "Intenções identificadas durante o atendimento.",
            "E-mail, quando fornecido voluntariamente.",
          ],
        },
        {
          title: "Seus direitos",
          list: [
            "Você pode solicitar a exclusão dos seus dados a qualquer momento pelo e-mail suporte@dnia.ai.",
            "Você pode exportar seu histórico de atendimento mediante solicitação.",
            "O DPO responsável é Rodrigo Nascimento (rodrigo@dnia.ai).",
          ],
        },
        {
          title: "Limitações do assistente",
          list: [
            "O assistente não toma decisões com efeitos jurídicos ou financeiros sobre você.",
            "Em caso de dúvidas complexas ou reclamações, você pode solicitar atendimento humano.",
            "As informações fornecidas pelo assistente têm caráter informativo e não substituem orientação profissional especializada.",
          ],
        },
        {
          title: "Base legal",
          paragraphs: [
            "O tratamento de dados neste atendimento é realizado com base no legítimo interesse (art. 7º, IX, LGPD) para prestação do serviço de atendimento contratado, e na execução de contrato (art. 7º, V, LGPD).",
          ],
        },
      ]}
      footer={[
        "DNIA AI | E-mail: suporte@dnia.ai | DPO: rodrigo@dnia.ai | Site: dnia.ai",
      ]}
    />
  );
};

export default LegalAutomatedServiceNotice;
