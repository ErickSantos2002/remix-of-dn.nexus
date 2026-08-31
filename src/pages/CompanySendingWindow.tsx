import { SendingWindowCard } from "@/components/settings/SendingWindowCard";

export default function CompanySendingWindow() {
  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Janela de envio</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Defina os dias e horários permitidos para o disparo automático de mensagens das réguas de cadência da empresa.
        </p>
      </div>
      <SendingWindowCard />
    </div>
  );
}
