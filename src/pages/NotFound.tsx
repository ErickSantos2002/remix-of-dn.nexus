import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
      <div className="dn-card flex w-full max-w-md flex-col items-center gap-4 p-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary/10">
          <Compass className="h-5 w-5 text-[var(--accent-ink)]" />
        </span>
        <span className="dn-eyebrow">Erro 404</span>
        <h1 className="text-2xl font-semibold text-foreground">Página não encontrada</h1>
        <p className="max-w-[42ch] text-sm text-muted-foreground">
          O endereço <span className="font-mono text-foreground">{location.pathname}</span> não
          existe ou foi movido.
        </p>
        <Button asChild className="mt-2">
          <Link to="/">Voltar para o início</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
