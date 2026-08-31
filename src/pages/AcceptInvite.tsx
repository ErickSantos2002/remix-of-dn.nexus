import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle, XCircle, Building2, Eye, EyeOff, User, Phone, Mail } from "lucide-react";

interface InviteDetails {
  id: string;
  email: string;
  role: string;
  company_name: string;
  expires_at: string;
  company_id: string;
  workspace_ids: string[] | null;
  invitee_name: string | null;
  invitee_phone: string | null;
}

const AcceptInvite = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });

  useEffect(() => {
    const fetchInvite = async () => {
      if (!token) {
        setError("Token de convite invalido.");
        setIsLoading(false);
        return;
      }

      try {
        // Use secure RPC to fetch invite by token (no direct table access)
        const { data: inviteRows, error: inviteError } = await supabase
          .rpc("get_invite_by_token", { p_token: token });

        if (inviteError) {
          console.error("[AcceptInvite] Fetch error:", inviteError);
          throw inviteError;
        }

        const data = Array.isArray(inviteRows) ? inviteRows[0] : inviteRows;

        if (!data) {
          setError("Convite nao encontrado ou ja foi utilizado.");
          setIsLoading(false);
          return;
        }

        // Check if expired
        if (new Date(data.expires_at) < new Date()) {
          setError("Este convite expirou. Solicite um novo convite ao administrador.");
          setIsLoading(false);
          return;
        }

        // Fetch company name via secure RPC
        const { data: companyRows } = await supabase
          .rpc("get_company_name_for_invite", { p_token: token });
        const companyRow = Array.isArray(companyRows) ? companyRows[0] : companyRows;
        
        const inviteData: InviteDetails = {
          id: data.id,
          email: data.email,
          role: data.role,
          company_name: companyRow?.company_name || "Empresa",
          expires_at: data.expires_at,
          company_id: data.company_id,
          workspace_ids: data.workspace_ids as string[] | null,
          invitee_name: data.invitee_name,
          invitee_phone: null,
        };

        setInvite(inviteData);

        // Pre-fill form with invite data
        setFormData({
          name: data.invitee_name || '',
          phone: '',
          password: '',
          confirmPassword: '',
        });
      } catch (err) {
        console.error("Error fetching invite:", err);
        setError("Erro ao carregar o convite.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvite();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite || !token) return;

    // Validate form
    if (!formData.name.trim()) {
      toast({ title: "Erro", description: "Nome e obrigatorio", variant: "destructive" });
      return;
    }
    if (formData.password.length < 6) {
      toast({ title: "Erro", description: "Senha deve ter no minimo 6 caracteres", variant: "destructive" });
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      toast({ title: "Erro", description: "As senhas nao conferem", variant: "destructive" });
      return;
    }

    setIsAccepting(true);
    try {
      console.log("[AcceptInvite] Calling accept-invite edge function...");
      
      // Call edge function to handle everything
      const { data, error: fnError } = await supabase.functions.invoke('accept-invite', {
        body: {
          token: token,
          password: formData.password,
          name: formData.name.trim(),
          phone: formData.phone.trim() || null,
        },
      });

      if (fnError) {
        console.error("[AcceptInvite] Edge function error:", fnError);
        throw new Error(fnError.message || "Erro ao processar convite");
      }

      if (data?.error) {
        console.error("[AcceptInvite] Edge function returned error:", data.error);
        throw new Error(data.error);
      }

      console.log("[AcceptInvite] Edge function success:", data);

      // Set workspace for redirect
      if (data.workspaceIds && data.workspaceIds.length > 0) {
        localStorage.setItem("selectedWorkspace", data.workspaceIds[0]);
      }

      toast({
        title: "Convite aceito com sucesso!",
        description: `Bem-vindo a ${data.companyName}!`,
      });

      // Sign in the user
      console.log("[AcceptInvite] Signing in user...");
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: formData.password,
      });

      if (signInError) {
        console.error("[AcceptInvite] Sign in error:", signInError);
        // Redirect to login with message
        toast({
          title: "Conta criada!",
          description: "Faca login para continuar.",
        });
        navigate("/login");
        return;
      }

      // Redirect to dashboard
      navigate("/");

    } catch (err: any) {
      console.error("[AcceptInvite] Error:", err);
      toast({
        title: "Erro",
        description: err.message || "Nao foi possivel aceitar o convite.",
        variant: "destructive",
      });
    } finally {
      setIsAccepting(false);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md glass-card">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Carregando convite...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Convite Invalido</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              variant="outline" 
              className="w-full" 
              onClick={() => navigate("/login")}
            >
              Ir para Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Invite found - show form
  if (!invite) return null;

  return (
    <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md glass-card">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Convite para {invite.company_name}</CardTitle>
          <CardDescription>
            Complete seu cadastro para acessar a empresa
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <div className="mb-6 p-4 rounded-lg bg-muted/50 border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Funcao:</span>
              <Badge variant="secondary">{invite.role}</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-foreground">{invite.email}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome completo</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="pl-10"
                  disabled={isAccepting}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Telefone (opcional)</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(00) 00000-0000"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="pl-10"
                  disabled={isAccepting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimo 6 caracteres"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="pr-10"
                  disabled={isAccepting}
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                placeholder="Repita a senha"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                disabled={isAccepting}
                required
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isAccepting}>
              {isAccepting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processando...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Aceitar Convite
                </>
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <p className="text-sm text-muted-foreground">
              Ja tem uma conta?{" "}
              <button
                type="button"
                onClick={() => navigate(`/login?redirect=${encodeURIComponent(`/accept-invite?token=${token}`)}`)}
                className="text-primary hover:underline"
              >
                Fazer login
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AcceptInvite;
