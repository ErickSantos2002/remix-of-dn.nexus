import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    global: "globalThis",
  },
  build: {
    sourcemap: "hidden",
    target: "es2020",
    cssCodeSplit: true,
    // manualChunks intencionalmente removido: separar react/react-router/@radix-ui
    // em chunks vendor causava erro de Temporal Dead Zone em produção
    // ("Cannot access 'S' before initialization") na rota /schedule/:id por
    // imports circulares entre os chunks. O chunking padrão do Vite é seguro
    // e o code-split por dynamic import() continua funcionando.
  },
}));
