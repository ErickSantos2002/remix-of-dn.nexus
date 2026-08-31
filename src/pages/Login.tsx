import { useEffect, useState } from "react";
import { FirstSetupDialog } from "@/components/auth/FirstSetupDialog";
import { Eye, EyeOff } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [showFirstSetup, setShowFirstSetup] = useState(false);
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { theme } = useTheme();
  
  const redirectUrl = searchParams.get("redirect");

  const legalLinks = [
    { label: "Política de Privacidade", to: "/legal/politica-de-privacidade" },
    { label: "Política de Segurança da Informação", to: "/legal/politica-de-seguranca-da-informacao" },
    { label: "Política de Cookies", to: "/legal/politica-de-cookies" },
    { label: "Aviso de Atendimento Automatizado (IA)", to: "/legal/aviso-de-atendimento-automatizado" },
    { label: "Termos de Uso", to: "/legal/termos-de-uso" },
  ];

  useEffect(() => {
    let active = true;
    supabase.functions
      .invoke("bootstrap-admin", { body: { action: "status" } })
      .then(({ data, error }) => {
        if (!active || error) return;
        setNeedsSetup(Boolean((data as { needs_setup?: boolean })?.needs_setup));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);



  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setIsLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao entrar",
        description: error.message === "Invalid login credentials" 
          ? "Email ou senha incorretos" 
          : error.message,
      });
      return;
    }

    navigate(redirectUrl || "/");
  };

  const handleForgotPassword = async () => {
    if (!resetEmail.trim()) {
      toast({
        variant: "destructive",
        title: "Email obrigatório",
        description: "Digite seu email para receber o link de redefinição.",
      });
      return;
    }

    setIsResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setIsResetting(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao enviar email",
        description: error.message,
      });
      return;
    }

    toast({
      title: "Email enviado!",
      description: "Verifique sua caixa de entrada para redefinir sua senha.",
    });
    setShowForgotPassword(false);
    setResetEmail("");
  };

  return (
    <div className="dn-atmosphere flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <form onSubmit={handleLogin} className="dn-card space-y-7 p-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <img
                src={theme === "premium" ? "/dn-nexus-light.png" : "/dn-nexus-dark.png"}
                alt="dn.nexus"
                className="h-14"
              />
              <span className="dn-eyebrow">Acesso à plataforma</span>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="dn-field-label">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="dn-field-label">
                  Senha
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setResetEmail(email);
                  setShowForgotPassword(true);
                }}
                className="rounded-[8px] text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-[var(--accent-ink)] hover:underline"
              >
                Esqueci minha senha
              </button>
            </div>
          </form>

          {needsSetup && (
            <div className="dn-card mt-4 border-primary/30 p-6">
              <span className="dn-eyebrow">Primeiro acesso</span>
              <h2 className="mt-3 text-base font-semibold text-foreground">Configurar sistema</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhum usuário cadastrado. Crie o administrador, a empresa e o primeiro workspace.
              </p>
              <Button type="button" className="mt-5 w-full" onClick={() => setShowFirstSetup(true)}>
                Criar administrador
              </Button>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-[var(--line)] px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
          <p className="text-center text-xs text-muted-foreground">
            Ao acessar a plataforma, você pode consultar nossos documentos legais.
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {legalLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="rounded-[8px] font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 transition-colors hover:text-[var(--accent-ink)] hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>

      <FirstSetupDialog
        open={showFirstSetup}
        onOpenChange={setShowFirstSetup}
        onCompleted={() => setNeedsSetup(false)}
      />

      {/* Forgot Password Dialog */}
      <Dialog open={showForgotPassword} onOpenChange={setShowForgotPassword}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              Digite seu email e enviaremos um link para você criar uma nova senha.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="seu@email.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                disabled={isResetting}
                              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowForgotPassword(false)}
              disabled={isResetting}
            >
              Cancelar
            </Button>
            <Button onClick={handleForgotPassword} disabled={isResetting}>
              {isResetting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                "Enviar link"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Login;