import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench, Calendar, Settings, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import Breadcrumbs from "@/components/layout/Breadcrumbs";

interface ToolCatalogItem {
  id: string;
  name: string;
  label: string;
  description: string | null;
  icon_name: string;
  category: string;
  requires_setup: string[];
  is_active: boolean;
  display_order: number;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Calendar,
  Wrench,
  Settings,
};

export default function ToolsCatalog() {
  const navigate = useNavigate();
  const [tools, setTools] = useState<ToolCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    try {
      const { data, error } = await supabase
        .from("tool_catalog")
        .select("*")
        .order("display_order", { ascending: true });

      if (error) throw error;
      setTools(data || []);
    } catch (error) {
      console.error("Error fetching tools:", error);
    } finally {
      setLoading(false);
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "calendar":
        return "bg-primary/20 text-primary";
      case "communication":
        return "bg-success/20 text-success";
      case "automation":
        return "bg-secondary text-secondary-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      <Breadcrumbs />

      <div className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">Catalogo de Tools</h1>
        <p className="text-muted-foreground">
          Ferramentas disponíveis para habilitar nos seus agentes
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => {
          const IconComponent = ICON_MAP[tool.icon_name] || Wrench;
          const hasSetupRequirements = tool.requires_setup && tool.requires_setup.length > 0;

          return (
            <Card key={tool.id} className="glass-card hover:border-primary/30 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <IconComponent className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{tool.label}</CardTitle>
                      <Badge className={`mt-1 ${getCategoryColor(tool.category)}`}>
                        {tool.category}
                      </Badge>
                    </div>
                  </div>
                  {tool.is_active ? (
                    <Badge variant="outline" className="border-success text-success">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Ativo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-muted-foreground text-muted-foreground">
                      Inativo
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription className="text-sm">
                  {tool.description}
                </CardDescription>

                {hasSetupRequirements && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
                    <AlertCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-medium text-warning">Requer configuração:</p>
                      <p className="text-muted-foreground mt-1">
                        {tool.requires_setup.join(", ")}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => navigate("/agents")}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Usar em Agente
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {tools.length === 0 && (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Wrench className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              Nenhuma ferramenta disponível no catálogo.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
