import { lazy, ComponentType } from "react";

const RELOAD_KEY = "nexus_chunk_reload_at";

/**
 * React.lazy com recuperacao para chunks obsoletos.
 * Apos um novo deploy, o arquivo JS antigo deixa de existir e o dynamic import
 * falha ("Failed to fetch dynamically imported module"), gerando tela branca.
 * Aqui tentamos de novo com cache-busting e, se ainda falhar, recarregamos a
 * pagina uma unica vez (protegido por sessionStorage para evitar loop).
 */
export function lazyRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch (error) {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
      const now = Date.now();
      if (now - last > 15000) {
        sessionStorage.setItem(RELOAD_KEY, String(now));
        window.location.reload();
        // Mantem o Suspense ativo enquanto a pagina recarrega
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}
