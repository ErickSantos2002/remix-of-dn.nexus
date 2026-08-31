import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { bindAudioUnlock } from "./lib/notificationSound";

// Destrava o AudioContext na primeira interacao do usuario para garantir
// que sons de notificacao toquem sem precisar clicar em "testar push" antes.
bindAudioUnlock();

// Conditional CSS: minimal stylesheet for the public scheduling widget,
// full design system for the authenticated app. Imported in parallel
// (not awaited) so React mounts immediately — the inline critical CSS in
// index.html already paints the background, so there is no FOUC.
const isPublicSchedule =
  typeof window !== "undefined" && window.location.pathname.startsWith("/schedule/");

if (isPublicSchedule) {
  import("./public-schedule.css");
} else {
  import("./index.css");
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
