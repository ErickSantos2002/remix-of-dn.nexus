import { lazy, Suspense, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const WidgetSettings = lazy(() => import("./WidgetSettings"));
const SchedulingWidgets = lazy(() => import("./SchedulingWidgets"));

const PanelLoader = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

export default function Widgets() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read initial tab from ?tab= or hash (#chat / #scheduling)
  const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  const initial =
    searchParams.get("tab") === "scheduling" || hash === "scheduling"
      ? "scheduling"
      : "chat";

  useEffect(() => {
    // Ensure URL reflects active tab on mount
    if (!window.location.hash) {
      window.history.replaceState(null, "", `#${initial}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tab = searchParams.get("tab") === "scheduling" ? "scheduling" : (hash === "scheduling" ? "scheduling" : "chat");

  const handleChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
    window.history.replaceState(null, "", `#${value}`);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Widgets</h1>
        <p className="text-muted-foreground text-sm">
          Configure widgets de chat e de agendamento para integrar em sites externos.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleChange}>
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="scheduling">Agendamento</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-6">
          <Suspense fallback={<PanelLoader />}>
            <WidgetSettings />
          </Suspense>
        </TabsContent>
        <TabsContent value="scheduling" className="mt-6">
          <Suspense fallback={<PanelLoader />}>
            <SchedulingWidgets />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
