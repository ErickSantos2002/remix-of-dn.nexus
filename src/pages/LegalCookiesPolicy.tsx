import LegalPageLayout from "@/components/legal/LegalPageLayout";

const LegalCookiesPolicy = () => {
  return (
    <LegalPageLayout
      title="Política de Cookies"
      version="1.0"
      updatedAt="março de 2026"
      intro={[
        "DNIA AI — Nexus Platform",
      ]}
      sections={[
        {
          title: "O que são cookies",
          paragraphs: [
            "Cookies são pequenos arquivos de texto armazenados no seu dispositivo quando você acessa uma plataforma digital. Eles permitem que a plataforma reconheça seu dispositivo e lembre preferências, mantendo sua sessão ativa e melhorando sua experiência de uso.",
          ],
        },
        {
          title: "Cookies utilizados pela DNIA AI",
          paragraphs: ["A plataforma Nexus utiliza os seguintes tipos de cookies:"],
          list: [
            "Cookies essenciais: necessários para o funcionamento da plataforma, como autenticação e manutenção de sessão. Não podem ser desativados.",
            "Cookies de desempenho: coletam informações sobre como a plataforma é utilizada para melhoria contínua. Não identificam o usuário individualmente.",
            "Cookies de preferências: armazenam configurações escolhidas pelo usuário (ex.: idioma, workspace selecionado).",
          ],
        },
        {
          title: "Cookies de terceiros",
          paragraphs: ["A plataforma pode utilizar serviços de terceiros que também instalam cookies:"],
          list: [
            "Supabase: para gerenciamento de sessão e autenticação.",
            "Google Analytics (se ativo): para análise de uso da plataforma.",
            "Esses serviços possuem suas próprias políticas de privacidade e cookies.",
          ],
        },
        {
          title: "Gerenciamento de cookies",
          paragraphs: [
            "Você pode gerenciar ou desativar cookies nas configurações do seu navegador. A desativação de cookies essenciais pode comprometer o funcionamento da plataforma. Para mais informações sobre como gerenciar cookies, consulte a documentação do seu navegador.",
          ],
        },
        {
          title: "Retenção",
          paragraphs: [
            "Os cookies de sessão são excluídos ao fechar o navegador. Cookies persistentes têm prazo máximo de 12 meses, salvo renovação por nova interação.",
          ],
        },
        {
          title: "Contato",
          paragraphs: ["Para dúvidas sobre nossa Política de Cookies:"],
          list: [
            "E-mail: suporte@dnia.ai.",
            "DPO: rodrigo@dnia.ai.",
          ],
        },
      ]}
      footer={[
        "DNIA AI — todos os direitos reservados | Atualizado em março de 2026",
      ]}
    />
  );
};

export default LegalCookiesPolicy;
