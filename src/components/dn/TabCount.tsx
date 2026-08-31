/**
 * Contador de aba do DN.IA Design System V3.
 *
 * Zero nao vira badge — aba vazia nao merece um selo apontando para o vazio.
 * Acima de 99 mostra "99+".
 */
export function TabCount({ value }: { value: number }) {
  if (!value) return null;

  return (
    <span className="rounded-[8px] bg-primary/[0.12] px-1.5 py-0.5 font-mono text-[0.625rem] font-bold text-[var(--accent-ink)]">
      {value > 99 ? "99+" : value}
    </span>
  );
}

export default TabCount;
