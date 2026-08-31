import { CatalogCrudCard } from "./CatalogCrudCard";
import { MessageCircleWarning } from "lucide-react";

export function ObjectionsCard() {
  return (
    <CatalogCrudCard
      table="crm_objections"
      queryKey="crm-objections"
      title="Objeções"
      sectionKey="objections"

      icon={<MessageCircleWarning className="h-5 w-5 text-primary" />}
      description="Gerencie as objeções levantadas pelos leads. Desabilitar remove a opção dos selects sem afetar registros já classificados."
      placeholder="Nova objeção (ex.: Preço alto, Já uso um concorrente...)"
      emptyMessage="Nenhuma objeção cadastrada. Adicione a primeira acima."
      singularLabel="Objeção"
    />
  );
}
