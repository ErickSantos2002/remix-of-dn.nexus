// Roteamento no frontend: só a transferência manual. A decisão de roteamento
// vive em supabase/functions/_shared/routing/ (spec §5.1); aqui ficam os
// rótulos (workhours/presence) e a ação humana explícita de transferir.
export { transferLead } from './transferLead';
