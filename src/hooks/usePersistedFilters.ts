import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const PREFIX = "nexus:filters";

function buildKey(name: string, userId: string | null, workspaceId: string | null) {
  if (!userId || !workspaceId) return null;
  return `${PREFIX}:${name}:${userId}:${workspaceId}`;
}

function readStorage<T>(key: string | null, fallback: T): T {
  if (!key || typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Merge com defaults para garantir que novos campos não fiquem undefined
    // em sessões com filtros antigos persistidos.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && fallback && typeof fallback === "object") {
      return { ...(fallback as object), ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/**
 * Persiste estado de filtros no localStorage com escopo por usuário + workspace.
 * Chave final: `nexus:filters:{name}:{userId}:{workspaceId}`.
 * Enquanto userId/workspaceId não estiverem disponíveis, comporta-se como useState
 * normal com o default (não persiste).
 */
export function usePersistedFilters<T>(
  name: string,
  defaultValue: T,
  workspaceId: string | null | undefined,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const [userId, setUserId] = useState<string | null>(null);

  // Carrega userId atual e escuta mudanças de auth.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const wsId = workspaceId ?? null;
  const storageKey = buildKey(name, userId, wsId);

  const [value, setValue] = useState<T>(() => readStorage(storageKey, defaultValue));

  // Quando muda escopo (user/workspace), recarrega do storage daquele escopo.
  const lastKeyRef = useRef<string | null>(storageKey);
  useEffect(() => {
    if (lastKeyRef.current === storageKey) return;
    lastKeyRef.current = storageKey;
    setValue(readStorage(storageKey, defaultValue));
    // defaultValue é tratado como estável; não incluímos para evitar reset acidental.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persiste a cada mudança.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // storage cheio ou indisponível — ignora silenciosamente
    }
  }, [storageKey, value]);

  const reset = useCallback(() => {
    setValue(defaultValue);
    if (storageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* noop */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return [value, setValue, reset];
}
