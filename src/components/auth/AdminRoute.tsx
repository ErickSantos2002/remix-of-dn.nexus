import { Navigate } from "react-router-dom";
import { Loader2, ShieldX } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute = ({ children }: AdminRouteProps) => {
  const { isAdmin, isLoading } = useUserRole();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <ShieldX className="h-16 w-16 text-destructive" />
        <h1 className="text-2xl font-bold text-foreground">Acesso Negado</h1>
        <p className="text-muted-foreground">
          Você precisa ser Admin para acessar esta página.
        </p>
        <a href="/" className="text-primary hover:underline">
          Voltar para Home
        </a>
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminRoute;
