import { CatalogCrudCard } from "./CatalogCrudCard";
import { HeartCrack } from "lucide-react";

export function PainsCard() {
  return (
    <CatalogCrudCard
      table="crm_pains"
      queryKey="crm-pains"
      title="Dores"
      sectionKey="pains"

      icon={<HeartCrack className="h-5 w-5 text-primary" />}
      description="Gerencie as dores identificadas nos leads. Desabilitar remove a opção dos selects sem afetar registros já classificados."
      placeholder="Nova dor (ex.: Falta de previsibilidade, Time sobrecarregado...)"
      emptyMessage="Nenhuma dor cadastrada. Adicione a primeira acima."
      singularLabel="Dor"
    />
  );
}
