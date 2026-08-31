type GtagFunction = (...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFunction;
    __nexus_gads_initialized?: Record<string, boolean>;
    __nexus_gads_load_promises?: Record<string, Promise<boolean>>;
  }
}

interface GoogleAdsConversionOptions {
  sendTo?: string | null;
  eventName: string;
  transactionId?: string;
  value?: number;
  currency?: string;
}

function getGoogleAdsId(sendTo?: string | null): string | null {
  const awId = sendTo?.split("/")[0]?.trim();
  if (!awId || !/^AW-/i.test(awId)) return null;
  return awId;
}

export function ensureGoogleAdsTag(sendTo?: string | null): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }

  const awId = getGoogleAdsId(sendTo);
  if (!awId) return Promise.resolve(false);

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    // IMPORTANTE: empurrar o objeto `arguments` real (não um array via rest-param).
    // Quando um container GTM está na página, o GTM sobrescreve dataLayer.push e só
    // reconhece objetos Arguments como comandos gtag; um array é ignorado, descartando
    // silenciosamente os eventos de conversão. Esta é a forma canônica do snippet do Google.
    function gtag() {
      // eslint-disable-next-line prefer-rest-params
      (window.dataLayer = window.dataLayer || []).push(arguments as unknown as unknown[]);
    }
    window.gtag = gtag as GtagFunction;
  }

  const initialized = window.__nexus_gads_initialized ?? (window.__nexus_gads_initialized = {});
  if (!initialized[awId]) {
    initialized[awId] = true;
    window.gtag("js", new Date());
    window.gtag("config", awId, { send_page_view: false });
  }

  const promises = window.__nexus_gads_load_promises ?? (window.__nexus_gads_load_promises = {});
  const existingPromise = promises[awId];
  if (existingPromise) return existingPromise;

  const existingScript = document.querySelector(`script[data-nexus-gads="${awId}"]`);
  if (existingScript) {
    console.log(`[GoogleAds] gtag.js already present for ${awId}`);
    return Promise.resolve(true);
  }

  promises[awId] = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(awId)}`;
    script.setAttribute("data-nexus-gads", awId);
    script.onload = () => {
      console.log(`[GoogleAds] gtag.js loaded for ${awId}`);
      resolve(true);
    };
    script.onerror = () => {
      console.error(`[GoogleAds] failed to load gtag.js for ${awId}`);
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return promises[awId];
}

export async function fireGoogleAdsConversion({
  sendTo,
  eventName,
  transactionId,
  value = 1,
  currency = "BRL",
}: GoogleAdsConversionOptions): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!sendTo) return false;

  const ready = await ensureGoogleAdsTag(sendTo);
  if (!ready || typeof window.gtag !== "function") return false;

  let callbackCalled = false;
  const timeoutMs = 2500;
  window.setTimeout(() => {
    if (!callbackCalled) {
      console.warn(`[GoogleAds] conversion callback timeout (${eventName}): ${sendTo}`);
    }
  }, timeoutMs + 300);

  const payload: Record<string, unknown> = {
    send_to: sendTo,
    value,
    currency,
    event_timeout: timeoutMs,
    event_callback: () => {
      callbackCalled = true;
      console.log(`[GoogleAds] conversion HIT sent (${eventName}): ${sendTo}`);
    },
  };

  if (transactionId) {
    payload.transaction_id = transactionId;
  }

  try {
    window.gtag("event", "conversion", payload);
    console.log(`[GoogleAds] conversion queued (${eventName}): ${sendTo}`);
    return true;
  } catch (error) {
    console.error(`[GoogleAds] conversion error (${eventName})`, error);
    return false;
  }
}
