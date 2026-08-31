import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompany } from "@/contexts/CompanyContext";

const WEEKDAYS = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

export function SendingWindowCard() {
  const { currentCompany, isAdmin, isOwner } = useCompany();
  const { toast } = useToast();
  const canEdit = isAdmin || isOwner;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);

  useEffect(() => {
    if (!currentCompany?.id) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("company_sending_window" as any)
        .select("start_time, end_time, weekdays")
        .eq("company_id", currentCompany.id)
        .maybeSingle();
      if (data) {
        setStart((data as any).start_time?.slice(0, 5) ?? "08:00");
        setEnd((data as any).end_time?.slice(0, 5) ?? "20:00");
        setWeekdays(((data as any).weekdays ?? [1, 2, 3, 4, 5]) as number[]);
      }
      setLoading(false);
    })();
  }, [currentCompany?.id]);

  const toggleDay = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  };

  const handleSave = async () => {
    if (!currentCompany?.id) return;
    setSaving(true);
    const { error } = await supabase
      .from("company_sending_window" as any)
      .upsert(
        {
          company_id: currentCompany.id,
          start_time: start,
          end_time: end,
          weekdays,
        },
        { onConflict: "company_id" }
      );
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    toast({ title: "Janela de envio salva", description: "As réguas vão respeitar este horário." });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Janela de envio
        </CardTitle>
        <CardDescription>
          Horário e dias da semana em que as réguas de mensagens podem disparar. Mensagens fora desta janela são descartadas silenciosamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Início</Label>
                <Input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label>Fim</Label>
                <Input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dias da semana</Label>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((d) => (
                  <label
                    key={d.value}
                    className="flex items-center gap-2 cursor-pointer text-sm"
                  >
                    <Checkbox
                      checked={weekdays.includes(d.value)}
                      onCheckedChange={() => toggleDay(d.value)}
                      disabled={!canEdit}
                    />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={!canEdit || saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
