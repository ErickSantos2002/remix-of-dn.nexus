import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail } from "lucide-react";

const Register = () => {
  const [searchParams] = useSearchParams();
  const redirectUrl = searchParams.get("redirect");
  const prefillEmail = searchParams.get("email");
  
  const [name, setName] = useState("");
  const [email, setEmail] = useState(prefillEmail || "");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme } = useTheme();

  // Pre-fill email from URL params
  useEffect(() => {
    if (prefillEmail) {
      setEmail(prefillEmail);
    }
  }, [prefillEmail]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const emailRedirectUrl = redirectUrl 
      ? `${window.location.origin}${redirectUrl}`
      : `${window.location.origin}/`;

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: emailRedirectUrl,
        data: {
          name: name.trim(),
        },
      },
    });

    setIsLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao criar conta",
        description: error.message === "User already registered"
          ? "Este email ja esta cadastrado. Faca login."
          : error.message,
      });
      return;
    }

    toast({
      title: "Conta criada com sucesso!",
      description: redirectUrl 
        ? "Voce sera redirecionado para aceitar o convite."
        : "Voce ja pode fazer login.",
    });
    
    // If there's a redirect URL (like accepting an invite), go there
    if (redirectUrl) {
      navigate(redirectUrl);
    } else {
      navigate("/login");
    }
  };

  return (
    <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <form onSubmit={handleRegister} className="dn-card space-y-7 p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <img
              src={theme === "premium" ? "/dn-nexus-light.png" : "/dn-nexus-dark.png"}
              alt="dn.nexus"
              className="h-14"
            />
            <span className="dn-eyebrow">Criar conta</span>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="dn-field-label">Nome</Label>
              <Input
                id="name"
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={isLoading}
               
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="dn-field-label">Email</Label>
              <div className="relative">
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading || !!prefillEmail}
                  className={prefillEmail ? "pr-12" : undefined}
                />
                {prefillEmail && (
                  <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary" />
                )}
              </div>
              {prefillEmail && (
                <p className="text-xs text-muted-foreground">
                  Email do convite (nao pode ser alterado)
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="dn-field-label">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={isLoading}
               
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Criando conta...
              </>
            ) : (
              "Criar Conta"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Já tem uma conta?{" "}
            <Link to="/login" className="text-primary hover:underline font-medium">
              Entrar
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Register;