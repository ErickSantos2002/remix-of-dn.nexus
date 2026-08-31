import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivityCadencesPanel } from "@/components/crm/cadences/ActivityCadencesPanel";
import { StageCadencesPanel } from "@/components/crm/cadences/StageCadencesPanel";

export default function CRMCadences() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "stage" ? "stage" : "activity";

  const handleChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
    window.history.replaceState(null, "", `#${value}`);
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Réguas</h1>
        <p className="text-muted-foreground text-sm">
          Configure mensagens automáticas por tipo de atividade ou por etapa do pipeline.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="activity">Atividade</TabsTrigger>
          <TabsTrigger value="stage">Etapa</TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="mt-6">
          <ActivityCadencesPanel />
        </TabsContent>
        <TabsContent value="stage" className="mt-6">
          <StageCadencesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
