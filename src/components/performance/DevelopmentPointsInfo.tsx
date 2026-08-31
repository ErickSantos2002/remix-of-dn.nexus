import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type DevelopmentPointKind = "open" | "recurrent" | "corrected";

interface Explanation {
  title: string;
  whatItIs: string;
  whatItIsFor: string;
  howItWorks: string[];
  badge: string;
}

/**
 * A regra por trás dos três cards não é óbvia olhando os números: por que um
 * ponto migra de bloco, o que o contador significa e — o mais confundido — que
 * reincidência NÃO derruba o score. Sem explicação à mão, o vendedor lê "3x"
 * como penalidade e o gestor cobra em cima de uma leitura errada.
 */
const EXPLANATIONS: Record<DevelopmentPointKind, Explanation> = {
  open: {
    title: "Pontos em aberto",
    whatItIs:
      "Itens do playbook (ou hábitos de conduta) que a IA apontou como não cumpridos uma única vez, e que ainda não voltaram a ser cumpridos em nenhuma avaliação posterior.",
    whatItIsFor:
      "É a lista de trabalho do vendedor: o que ele precisa fazer diferente no próximo atendimento. Um ponto em aberto ainda não é um problema crônico — é um aviso de primeira ocorrência.",
    howItWorks: [
      "Cada avaliação produz um veredicto por critério: atendido, parcial ou não atendido.",
      "Um critério não atendido pela primeira vez cria o ponto aqui, com contador 1.",
      "Se voltar a falhar, o ponto migra para Recorrentes. Se for cumprido, migra para Corrigidos.",
      "Veredicto parcial não move nada — nem cria, nem resolve.",
    ],
    badge: "O número ao lado é quantas vezes o item já foi apontado como falha.",
  },
  recurrent: {
    title: "Falhas recorrentes",
    whatItIs:
      "Itens que o vendedor deixou de cumprir em duas ou mais avaliações — a mesma falha se repetindo ao longo do tempo.",
    whatItIsFor:
      "É o sinal de que orientação pontual não resolveu e o ponto precisa virar pauta de coaching. Para o gestor, é o indicador mais acionável do painel: mostra onde o feedback não está pegando.",
    howItWorks: [
      "Um ponto em aberto que falha de novo passa a recorrente e o contador sobe.",
      "Cada nova falha incrementa o contador; a data da última falha situa o ponto no período.",
      "Um ponto já corrigido que volta a falhar retorna para cá — regredir depois de corrigir também é recorrência.",
      "Recorrência NÃO reduz o score. O score de cada atendimento sai só dos critérios daquela conversa, com peso. A recorrência é alerta, não punição.",
    ],
    badge: "O número ao lado é o total de falhas acumuladas naquele item.",
  },
  corrected: {
    title: "Pontos corrigidos",
    whatItIs:
      "Itens que estavam em aberto ou recorrentes e que, em uma avaliação posterior, o vendedor passou a cumprir.",
    whatItIsFor:
      "Mede evolução, não desempenho atual. Um ponto corrigido depois de três falhas é uma vitória maior do que um corrigido na primeira tentativa — por isso o contador de falhas anteriores continua visível.",
    howItWorks: [
      "Um ponto em aberto ou recorrente que recebe veredicto atendido migra para cá.",
      "O contador não zera: ele preserva quantas vezes o item falhou antes de ser resolvido.",
      "A correção não é definitiva — se o item voltar a falhar, o ponto retorna para Recorrentes.",
      "A data da correção é o que situa o ponto no período selecionado.",
    ],
    badge: "O número ao lado é quantas vezes o item falhou antes de ser corrigido.",
  },
};

/** Ícone de ajuda ao lado do título do card, com a regra completa em dialog. */
export function DevelopmentPointsInfo({ kind }: { kind: DevelopmentPointKind }) {
  const [open, setOpen] = useState(false);
  const explanation = EXPLANATIONS[kind];

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        aria-label={`Como funciona: ${explanation.title}`}
      >
        <Info className="h-3.5 w-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-card border-border sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{explanation.title}</DialogTitle>
            <DialogDescription>{explanation.whatItIs}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <section className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">Para que serve</h4>
              <p className="text-sm text-muted-foreground">{explanation.whatItIsFor}</p>
            </section>

            <section className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">Como é calculado</h4>
              <ul className="space-y-1.5">
                {explanation.howItWorks.map((rule) => (
                  <li key={rule} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary shrink-0">•</span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ul>
            </section>

            <p className="text-xs text-muted-foreground rounded-lg border border-border bg-background/40 p-3">
              {explanation.badge}
            </p>

            <p className="text-xs text-muted-foreground">
              Os três blocos respeitam o período selecionado no topo da página: um ponto aparece no período
              em que falhou ou foi corrigido.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
