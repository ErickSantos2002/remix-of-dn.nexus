import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import {
  getResendKey,
  ResendError,
  resendErrorResponse,
  resolveFromAddress,
  RESEND_FROM_NOT_CONFIGURED,
} from "../_shared/resendCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteEmailRequest {
  email: string;
  companyName: string;
  inviteLink: string;
  role: string;
  inviterName?: string;
  inviteeName?: string;
  // New (preferred): company id for per-company Resend credentials
  company_id?: string;
  companyId?: string;
}


const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: InviteEmailRequest = await req.json();
    const { email, companyName, inviteLink, role, inviterName, inviteeName } = body;
    const companyId = body.company_id || body.companyId;

    if (!companyId) {
      console.log("[send-invite-email] Missing company_id, skipping email");
      return new Response(
        JSON.stringify({ success: false, error: "company_id obrigatorio", code: "missing_company_id", emailSent: false }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let creds;
    try {
      creds = await getResendKey(companyId);
    } catch (err) {
      const payload = resendErrorResponse(err);
      console.log(`[send-invite-email] Resend not available for company ${companyId}: ${payload.error}`);
      return new Response(
        JSON.stringify({ success: false, emailSent: false, ...payload }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const resend = new Resend(creds.apiKey);
    const from = resolveFromAddress(creds.fromEmail, companyName);
    if (!from) {
      console.log(`[send-invite-email] Missing sender domain for company ${companyId}`);
      return new Response(
        JSON.stringify({ success: false, emailSent: false, error: RESEND_FROM_NOT_CONFIGURED, code: "resend_from_not_configured" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }


    console.log(`[send-invite-email] Sending invite to ${email} for ${companyName} from ${from}`);

    const roleLabel = role === "admin" ? "Administrador" : "Membro";
    const greeting = inviteeName ? `Ola ${inviteeName}!` : "Ola!";

    const emailResponse = await resend.emails.send({
      from,
      to: [email],
      subject: `${inviteeName ? inviteeName + ', voce' : 'Voce'} foi convidado para ${companyName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0D0B0A;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0D0B0A; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #161311; border-radius: 12px; border: 1px solid #262220;">
                  <tr>
                    <td style="padding: 40px;">
                      <h1 style="color: #E41A11; font-size: 24px; margin: 0 0 24px 0; text-align: center;">
                        Nexus AI
                      </h1>
                      
                      <h2 style="color: #FAFAF9; font-size: 20px; margin: 0 0 16px 0;">
                        ${greeting}
                      </h2>
                      
                      <p style="color: #8C7A6E; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                        ${inviterName ? `${inviterName} convidou voce` : 'Voce foi convidado'} para fazer parte da empresa 
                        <strong style="color: #FAFAF9;">${companyName}</strong> como <strong style="color: #3D61FF;">${roleLabel}</strong>.
                      </p>
                      
                      <div style="background-color: #0D0B0A; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                        <p style="color: #8C7A6E; font-size: 14px; margin: 0 0 8px 0;">O que voce precisa fazer:</p>
                        <ol style="color: #FAFAF9; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                          <li>Clique no botao abaixo para aceitar o convite</li>
                          <li>Crie sua conta com o email <strong style="color: #3D61FF;">${email}</strong></li>
                          <li>Defina sua senha e comece a usar a plataforma</li>
                        </ol>
                      </div>
                      
                      <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" style="padding: 24px 0;">
                            <a href="${inviteLink}" style="display: inline-block; background: #3D61FF; color: #FFFFFF; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 14px rgba(61, 97, 255, 0.3);">
                              Aceitar Convite
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="color: #8C7A6E; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                        Se o botao nao funcionar, copie e cole este link no seu navegador:
                      </p>
                      <p style="color: #3D61FF; font-size: 12px; word-break: break-all; margin: 8px 0 0 0;">
                        ${inviteLink}
                      </p>
                      
                      <hr style="border: none; border-top: 1px solid #262220; margin: 32px 0;" />
                      
                      <p style="color: #8C7A6E; font-size: 12px; text-align: center; margin: 0;">
                        Este convite expira em 7 dias. Se voce nao solicitou este convite, pode ignorar este email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailSent: true, data: emailResponse }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending invite email:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        emailSent: false 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);