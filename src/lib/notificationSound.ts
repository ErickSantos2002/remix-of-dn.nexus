let audioContext: AudioContext | null = null;
let unlockBound = false;

function getAudioContext(): AudioContext | null {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) {
    audioContext = new AudioCtx();
  }
  return audioContext;
}

/**
 * Destrava o AudioContext na primeira interação do usuario com a pagina.
 * Necessario por causa das politicas de autoplay dos navegadores: sem isso
 * o AudioContext permanece "suspended" e nenhum som toca ate o usuario
 * clicar em algo que explicitamente chame play.
 */
export function bindAudioUnlock() {
  if (unlockBound) return;
  if (typeof window === "undefined") return;
  unlockBound = true;

  const unlock = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch {
      // ignore
    }
    window.removeEventListener("click", unlock);
    window.removeEventListener("keydown", unlock);
    window.removeEventListener("touchstart", unlock);
    window.removeEventListener("pointerdown", unlock);
  };

  window.addEventListener("click", unlock, { once: false });
  window.addEventListener("keydown", unlock, { once: false });
  window.addEventListener("touchstart", unlock, { once: false });
  window.addEventListener("pointerdown", unlock, { once: false });
}

export function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Garante que o contexto esteja ativo (caso o navegador tenha suspendido)
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    // First tone - higher pitch "ding"
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.3);

    // Second tone - slightly delayed
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
    osc2.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.35);
    gain2.gain.setValueAtTime(0, ctx.currentTime);
    gain2.gain.setValueAtTime(0.25, ctx.currentTime + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.15);
    osc2.stop(ctx.currentTime + 0.5);
  } catch (err) {
    console.error("Error playing notification sound:", err);
  }
}

export function showBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void
) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  playNotificationSound();

  try {
    const notification = new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag: `${title}-${Date.now()}`,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      onClick?.();
    };
  } catch (err) {
    console.error("Error showing browser notification:", err);
  }
}
