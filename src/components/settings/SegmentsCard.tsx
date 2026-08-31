import { CatalogCrudCard } from "./CatalogCrudCard";
import { Building2 } from "lucide-react";

export function SegmentsCard() {
  return (
    <CatalogCrudCard
      table="crm_segments"
      queryKey="crm-segments"
      title="Segmentos"
      sectionKey="segments"
      supportsDefault
      requireDefault
      icon={<Building2 className="h-5 w-5 text-primary" />}
      description="Gerencie os segmentos dos leads. Marque um segmento como padrão: ele é usado quando a API receber um valor que não está cadastrado."
      placeholder="Novo segmento (ex.: Saúde, Educação, Indústria...)"
      emptyMessage="Nenhum segmento cadastrado. Adicione o primeiro acima."
      singularLabel="Segmento"
    />
  );
}
