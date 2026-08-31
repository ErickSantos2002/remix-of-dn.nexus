import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, BarChart3 } from "lucide-react";
import { CadenceTemplateEditor } from "@/components/crm/cadences/CadenceTemplateEditor";
import { CadenceStatsDialog, type CadenceStatsRule } from "@/components/crm/cadences/CadenceStatsDialog";
import { CadenceOverviewDialog } from "@/components/crm/cadences/CadenceOverviewDialog";


const ACTIVITY_TYPES = [
  { value: "meeting", label: "Reunião" },
  { value: "call", label: "Ligação" },
  { value: "follow_up", label: "Follow-up" },
  { value: "email", label: "Email" },
  { value: "demo", label: "Demo" },
  { value: "task", label: "Tarefa" },
  { value: "reschedule", label: "Reagendamento de reunião" },
];

export function ActivityCadencesPanel() {
  const { currentCompany } = useCompany();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<any[]>([]);
  const [newType, setNewType] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statsRule, setStatsRule] = useState<CadenceStatsRule | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);


  const fetchRules = async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("cadence_rules" as any)
      .select("*")
      .eq("company_id", currentCompany.id)
      .eq("trigger_type", "activity")
      .order("created_at");
    setRules((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { fetchRules(); /* eslint-disable-next-line */ }, [currentCompany?.id]);

  const createRule = async () => {
    if (!newType || !currentCompany?.id) return;
    const { error } = await supabase.from("cadence_rules" as any).insert({
      company_id: currentCompany.id,
      trigger_type: "activity",
      activity_type: newType,
      name: ACTIVITY_TYPES.find((t) => t.value === newType)?.label,
    });
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    setNewType("");
    fetchRules();
  };

  const toggleActive = async (id: string, val: boolean) => {
    await supabase.from("cadence_rules" as any).update({ is_active: val }).eq("id", id);
    fetchRules();
  };

  const deleteRule = async (id: string) => {
    if (!confirm("Excluir esta régua e todas suas mensagens?")) return;
    await supabase.from("cadence_rules" as any).delete().eq("id", id);
    fetchRules();
  };

  const availableTypes = ACTIVITY_TYPES.filter(
    (t) => !rules.some((r) => r.activity_type === t.value)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-muted-foreground text-sm">
          Mensagens automáticas enviadas antes de tarefas/reuniões agendadas no CRM.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOverviewOpen(true)}>
          <BarChart3 className="h-4 w-4 mr-1" /> Estatísticas gerais
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nova régua</CardTitle>
          <CardDescription>Escolha o tipo de atividade. Uma régua por tipo.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
            <SelectContent>
              {availableTypes.length === 0 && (
                <div className="p-2 text-sm text-muted-foreground">Todos os tipos já têm régua</div>
              )}
              {availableTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={createRule} disabled={!newType}>
            <Plus className="h-4 w-4 mr-1" /> Criar
          </Button>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        rules.map((r) => {
          const isOpen = expanded === r.id;
          return (
            <Card key={r.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 cursor-pointer" onClick={() => setExpanded(isOpen ? null : r.id)}>
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <CardTitle className="text-base">
                    {ACTIVITY_TYPES.find((t) => t.value === r.activity_type)?.label || r.activity_type}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <Switch checked={r.is_active} onCheckedChange={(v) => toggleActive(r.id, v)} />
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Estatísticas"
                    onClick={() => setStatsRule({ id: r.id, name: r.name, trigger_type: "activity", activity_type: r.activity_type })}
                  >
                    <BarChart3 className="h-4 w-4 text-primary" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteRule(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>

                </div>
              </CardHeader>
              {isOpen && (
                <CardContent>
                  <CadenceTemplateEditor ruleId={r.id} triggerType="activity" />
                </CardContent>
              )}
            </Card>
          );
        })
      )}
      <CadenceStatsDialog
        rule={statsRule}
        open={!!statsRule}
        onOpenChange={(o) => !o && setStatsRule(null)}
      />
      <CadenceOverviewDialog
        triggerType="activity"
        open={overviewOpen}
        onOpenChange={setOverviewOpen}
      />
    </div>
  );
}

