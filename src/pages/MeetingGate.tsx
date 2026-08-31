import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Video, Users, Mail, User, LogIn, AlertCircle } from "lucide-react";

type ApptInfo = {
  id: string;
  workspace_id: string;
  title: string | null;
  start_time: string | null;
  room_name: string;
  meeting_type: string | null;
  meeting_started_at: string | null;
  meeting_ended_at: string | null;
};

type ContactInfo = { name: string | null; email: string | null } | null;

export default function MeetingGate() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const navigate = useNavigate();

  const [stage, setStage] = useState<"loading" | "decide" | "guest-form" | "joining" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [appt, setAppt] = useState<ApptInfo | null>(null);
  const [contact, setContact] = useState<ContactInfo>(null);
  const [hasSession, setHasSession] = useState<boolean>(false);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  const decided = useRef(false);

  // 1) Load appointment info + check session in parallel
  useEffect(() => {
    if (!appointmentId) {
      setError("Reunião inválida.");
      setStage("error");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [infoRes, sessionRes] = await Promise.all([
          supabase.functions.invoke("meeting-gate-info", {
            body: { appointment_id: appointmentId },
          }),
          supabase.auth.getSession(),
        ]);

        if (cancelled) return;

        if (infoRes.error || !infoRes.data?.appointment) {
          const msg =
            (infoRes.data as { error?: string } | undefined)?.error === "not_found"
              ? "Reunião não encontrada."
              : "Não foi possível carregar a reunião.";
          setError(msg);
          setStage("error");
          return;
        }

        const apptData = infoRes.data.appointment as ApptInfo;
        const contactData = (infoRes.data.contact ?? null) as ContactInfo;

        setAppt(apptData);
        setContact(contactData);
        setGuestName(contactData?.name ?? "");
        setGuestEmail(contactData?.email ?? "");

        const session = sessionRes.data.session;
        setHasSession(!!session);
        setSessionEmail(session?.user?.email ?? null);

        if (apptData.meeting_ended_at) {
          setStage("decide"); // we'll show ended state via UI below
        } else {
          setStage("decide");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[MeetingGate] load error:", err);
        setError("Erro ao carregar a reunião.");
        setStage("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  // 2) Helper: redirect to Daily with a fresh token
  const enterRoom = useCallback(
    async (params: { isOwner: boolean; userName: string }) => {
      if (!appt) return;
      setStage("joining");
      setError(null);
      try {
        // HOST: navegar para MeetingRoom (dentro do app) para manter banner
        // de fallback manual de gravação/transcrição caso o auto-start falhe.
        if (params.isOwner) {
          const { data: sessionData } = await supabase.auth.getSession();
          const accessToken = sessionData.session?.access_token;
          if (!accessToken) {
            throw new Error("Sessão expirada. Entre novamente.");
          }
          navigate(`/meeting/${appt.room_name}?token=${encodeURIComponent(accessToken)}`);
          return;
        }

        // GUEST: fallback marker antes do token
        try {
          await supabase.functions.invoke("daily-room", {
            body: {
              action: "validate-guest",
              room_name: appt.room_name,
              email: guestEmail.trim() || null,
              name: params.userName,
            },
          });
        } catch (vErr) {
          console.warn("[MeetingGate] validate-guest soft-failed:", vErr);
        }

        const { data, error: fnError } = await supabase.functions.invoke("daily-room", {
          body: {
            action: "guest-token",
            room_name: appt.room_name,
            user_name: params.userName,
            is_owner: false,
          },
        });

        if (fnError || !data?.token) {
          const msg =
            (data as { message?: string; error?: string } | undefined)?.message ||
            (data as { error?: string } | undefined)?.error ||
            "Não foi possível obter acesso à reunião.";
          throw new Error(msg);
        }

        const roomUrl = data.room_url || `https://app.daily.co/${appt.room_name}`;
        const joinUrl = new URL(roomUrl);
        joinUrl.searchParams.set("t", data.token);
        joinUrl.searchParams.set("lang", "pt-BR");
        window.location.replace(joinUrl.toString());
      } catch (err) {
        console.error("[MeetingGate] enter error:", err);
        setError(err instanceof Error ? err.message : "Erro ao entrar na reunião.");
        setStage("decide");
      }
    },
    [appt, guestEmail, navigate],
  );


  // 3) Auto-host: if there's a session, try to enter as owner automatically.
  //    Backend revalidates workspace membership and downgrades to guest if not allowed.
  useEffect(() => {
    if (stage !== "decide" || decided.current) return;
    if (!hasSession || !appt) return;
    // Host (logged-in member) can always rejoin, even after meeting_ended_at.
    // Backend (daily-room host-token) revalidates workspace membership.
    decided.current = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data.user;
      const userName =
        u?.user_metadata?.name ||
        u?.user_metadata?.full_name ||
        u?.email?.split("@")[0] ||
        "Membro";
      enterRoom({ isOwner: true, userName });
    })();
  }, [stage, hasSession, appt, enterRoom]);

  // -------- UI --------
  if (stage === "loading") {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md glass-card">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Não foi possível abrir a reunião</h2>
            <p className="text-muted-foreground">{error || "Tente novamente em instantes."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Only show "ended" screen to guests (no session). Hosts can rejoin.
  if (appt?.meeting_ended_at && !hasSession) {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md glass-card">
          <CardContent className="pt-6 text-center space-y-4">
            <Video className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-xl font-semibold text-foreground">Reunião encerrada</h2>
            <p className="text-muted-foreground">Esta reunião já foi finalizada.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // joining (after click): show spinner
  if (stage === "joining") {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Conectando à reunião...</p>
        </div>
      </div>
    );
  }

  // decide: with session → spinner (auto-join firing); without session → show options
  if (hasSession && !decided.current) {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // No session OR user chose guest form
  if (stage === "guest-form") {
    return (
      <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md glass-card">
          <CardHeader className="text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-xl text-foreground">Entrar como convidado</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {appt?.title || "Preencha seus dados para participar"}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
            )}

            <div className="space-y-2">
              <Label htmlFor="guest-email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                Email
              </Label>
              <Input
                id="guest-email"
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="seu@email.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="guest-name" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Nome
              </Label>
              <Input
                id="guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Seu nome completo"
              />
            </div>

            <Button
              onClick={() => enterRoom({ isOwner: false, userName: guestName.trim() || "Convidado" })}
              disabled={!guestName.trim() || !guestEmail.trim()}
              className="w-full"
              size="lg"
            >
              <Video className="h-4 w-4 mr-2" />
              Entrar na reunião
            </Button>

            <button
              onClick={() => setStage("decide")}
              className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
            >
              Voltar
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // decide screen (no active session)
  const firstName = (contact?.name || "").trim().split(/\s+/)[0] || "";
  const meetingDateLabel = appt?.start_time
    ? new Date(appt.start_time).toLocaleDateString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
      })
    : null;
  const meetingTimeLabel = appt?.start_time
    ? new Date(appt.start_time).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
    : null;

  return (
    <div className="dn-atmosphere flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md glass-card">
        <CardHeader className="text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Video className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">
            {firstName ? `Olá, ${firstName}!` : "Olá!"}
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            {appt?.title || "Sua reunião está pronta"}
          </p>
          {meetingDateLabel && meetingTimeLabel && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-muted/40 text-sm text-foreground">
              <div className="capitalize">{meetingDateLabel}</div>
              <div className="font-mono text-primary">às {meetingTimeLabel}</div>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          <Button
            onClick={() => setStage("guest-form")}
            variant="default"
            className="w-full"
            size="lg"
          >
            <Users className="h-4 w-4 mr-2" />
            Entrar na reunião
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

