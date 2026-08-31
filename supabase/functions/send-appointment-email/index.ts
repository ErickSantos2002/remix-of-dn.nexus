import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import {
  getResendKey,
  resendErrorResponse,
  resolveFromAddress,
  RESEND_FROM_NOT_CONFIGURED,
} from "../_shared/resendCredentials.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};


interface Attendee {
  name: string;
  email?: string;
  role: "contact" | "assignee" | "creator" | "guest";
}

interface AppointmentEmailRequest {
  type: "confirmation" | "cancellation" | "reschedule";
  email: string;
  contactName: string;
  appointmentTitle: string;
  startTime: string;
  endTime?: string;
  meetingLink?: string;
  assigneeName?: string;
  companyName?: string;
  oldStartTime?: string;
  // Support for different recipient types
  recipientType?: "contact" | "assignee" | "creator";
  leadName?: string;
  creatorName?: string;
  // NEW: List of all attendees for the meeting
  attendees?: Attendee[];
  // NEW: company id for per-company Resend credentials
  company_id?: string;
  companyId?: string;
  // NEW: custom template overrides (for contact-type confirmation only)
  customSubject?: string;
  customBody?: string;
}

// Format date for calendar block
function formatCalendarBlock(dateStr: string): { month: string; day: number; dayName: string } {
  const date = new Date(dateStr);
  
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
  
  // Use São Paulo timezone
  const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Sao_Paulo' };
  const localDate = new Date(date.toLocaleString('en-US', options));
  
  return {
    month: months[localDate.getMonth()],
    day: localDate.getDate(),
    dayName: days[localDate.getDay()]
  };
}

// Format full date in Portuguese
function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  
  const days = ["Domingo", "Segunda-feira", "Terca-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sabado"];
  const months = ["Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  
  const options: Intl.DateTimeFormatOptions = { timeZone: 'America/Sao_Paulo' };
  const localDate = new Date(date.toLocaleString('en-US', options));
  
  return `${days[localDate.getDay()]}, ${localDate.getDate()} de ${months[localDate.getMonth()]}`;
}

// Format time in São Paulo timezone
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

// Get greeting and message based on recipient type
function getRecipientContext(data: AppointmentEmailRequest): { greeting: string; message: string; badge: string } {
  const recipientType = data.recipientType || "contact";
  
  switch (recipientType) {
    case "assignee":
      return {
        badge: "Nova Reuniao Atribuida",
        greeting: `Ola ${data.contactName}`,
        message: `Uma nova reuniao foi agendada para voce atender o contato <strong>${data.leadName || 'Cliente'}</strong>. Confira os detalhes abaixo e prepare-se para o atendimento.`
      };
    case "creator":
      return {
        badge: "Reuniao Criada com Sucesso",
        greeting: `Ola ${data.contactName}`,
        message: `Voce agendou uma reuniao com <strong>${data.leadName || 'o cliente'}</strong>${data.assigneeName ? `, atribuida a ${data.assigneeName}` : ''}. Confira os detalhes abaixo.`
      };
    case "contact":
    default:
      return {
        badge: "Reuniao Confirmada",
        greeting: `Ola ${data.contactName}`,
        message: `Sua reuniao foi confirmada com sucesso. Voce recebera um lembrete antes do horario marcado.`
      };
  }
}

// Generate confirmation email HTML (Google Calendar style)
function generateConfirmationEmail(data: AppointmentEmailRequest): string {
  const calendar = formatCalendarBlock(data.startTime);
  const fullDate = formatFullDate(data.startTime);
  const time = formatTime(data.startTime);
  const endTime = data.endTime ? formatTime(data.endTime) : null;
  const context = getRecipientContext(data);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${context.badge}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3F6FB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F3F6FB;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 620px; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; border: 1px solid #D1D9E6; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);">

          <tr>
            <td style="padding: 24px 24px 10px 24px;">
              <span style="display: inline-block; padding: 7px 12px; background: #1D4ED8; border-radius: 999px; color: #FFFFFF; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;">
                ${context.badge}
              </span>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 24px 8px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="104" style="vertical-align: top; padding-right: 16px;">
                    <div style="background: #F8FAFC; border-radius: 12px; text-align: center; overflow: hidden; border: 1px solid #D1D9E6;">
                      <div style="background: #1D4ED8; color: #FFFFFF; padding: 8px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                        ${calendar.month}
                      </div>
                      <div style="padding: 14px 10px;">
                        <div style="font-size: 38px; font-weight: 800; color: #0F172A; line-height: 1;">${calendar.day}</div>
                        <div style="font-size: 13px; color: #334155; margin-top: 4px; font-weight: 600;">${calendar.dayName}</div>
                      </div>
                    </div>
                  </td>

                  <td style="vertical-align: top;">
                    <h2 style="color: #0F172A; margin: 0 0 8px 0; font-size: 22px; font-weight: 700; line-height: 1.25;">
                      ${data.appointmentTitle}
                    </h2>

                    <div style="margin-top: 16px;">
                      <span style="color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">Quando</span>
                      <p style="color: #0F172A; margin: 6px 0 0 0; font-size: 15px; line-height: 1.5;">
                        ${fullDate}<br>
                        ${time}${endTime ? ` - ${endTime}` : ''} (Horário de Brasília)
                      </p>
                    </div>

                    ${data.assigneeName && data.recipientType === 'contact' ? `
                    <div style="margin-top: 14px;">
                      <span style="color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">Com quem</span>
                      <p style="color: #0F172A; margin: 6px 0 0 0; font-size: 15px;">
                        ${data.assigneeName}
                      </p>
                    </div>
                    ` : ''}

                    ${data.leadName && (data.recipientType === 'assignee' || data.recipientType === 'creator') ? `
                    <div style="margin-top: 14px;">
                      <span style="color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">Cliente</span>
                      <p style="color: #0F172A; margin: 6px 0 0 0; font-size: 15px;">
                        ${data.leadName}
                      </p>
                    </div>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${data.meetingLink ? `
          <tr>
            <td style="padding: 10px 24px 0 24px;">
              <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px; padding: 14px;">
                <p style="margin: 0 0 6px 0; color: #1E3A8A; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;">Link da reunião</p>
                <a href="${data.meetingLink}" style="color: #1D4ED8; font-size: 14px; font-weight: 600; text-decoration: underline; word-break: break-all;">
                  ${data.meetingLink}
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 18px 24px 4px 24px;">
              <a href="${data.meetingLink}" style="display: inline-block; background: #1D4ED8; color: #FFFFFF; padding: 14px 34px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 15px;">
                Entrar na reunião
              </a>
            </td>
          </tr>
          ` : ''}

          ${data.attendees && data.attendees.length > 0 ? `
          <tr>
            <td style="padding: 14px 24px 0 24px;">
              <span style="color: #334155; font-size: 12px; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700;">Participantes</span>
              <div style="margin-top: 8px;">
                ${data.attendees.map((a) => `
                  <div style="color: #0F172A; font-size: 14px; margin-bottom: 4px;">
                    ${a.name}${a.email ? ` <span style="color: #475569;">(${a.email})</span>` : ''}
                  </div>
                `).join('')}
              </div>
            </td>
          </tr>
          ` : ''}

          <tr>
            <td style="padding: 20px 24px 24px 24px;">
              <p style="color: #334155; font-size: 14px; margin: 0; line-height: 1.6;">
                ${context.greeting},<br><br>
                ${context.message}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 16px 24px; border-top: 1px solid #D1D9E6; background: #F8FAFC;">
              <p style="color: #475569; font-size: 12px; margin: 0; text-align: center;">
                ${data.companyName ? `${new Date().getFullYear()} ${data.companyName}` : 'Agendamento automático'}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Generate cancellation email HTML
function generateCancellationEmail(data: AppointmentEmailRequest): string {
  const calendar = formatCalendarBlock(data.startTime);
  const fullDate = formatFullDate(data.startTime);
  const time = formatTime(data.startTime);
  const context = getRecipientContext(data);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reuniao Cancelada</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0D0B0A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0D0B0A;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #161311; border-radius: 16px; overflow: hidden; border: 1px solid #262220;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px 24px 16px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="display: inline-block; padding: 6px 12px; background: #3D2828; border: 1px solid #5C3A3A; border-radius: 20px; color: #E57373; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                      Reuniao Cancelada
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 0 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <!-- Calendar Block (muted) -->
                  <td width="100" style="vertical-align: top; padding-right: 20px; opacity: 0.6;">
                    <div style="background: #0D0B0A; border-radius: 12px; text-align: center; overflow: hidden; border: 1px solid #262220;">
                      <div style="background: #3D2828; color: #E57373; padding: 8px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                        ${calendar.month}
                      </div>
                      <div style="padding: 16px 12px;">
                        <div style="font-size: 42px; font-weight: 700; color: #6B5B4F; line-height: 1; text-decoration: line-through;">${calendar.day}</div>
                        <div style="font-size: 13px; color: #6B5B4F; margin-top: 4px; font-weight: 500;">${calendar.dayName}</div>
                      </div>
                    </div>
                  </td>
                  
                  <!-- Event Details -->
                  <td style="vertical-align: top;">
                    <!-- Title -->
                    <h2 style="color: #8C7A6E; margin: 0 0 8px 0; font-size: 20px; font-weight: 600; line-height: 1.3; text-decoration: line-through;">
                      ${data.appointmentTitle}
                    </h2>
                    
                    <!-- When (struck through) -->
                    <div style="margin-top: 20px;">
                      <span style="color: #6B5B4F; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Quando</span>
                      <p style="color: #6B5B4F; margin: 6px 0 0 0; font-size: 15px; line-height: 1.4; text-decoration: line-through;">
                        ${fullDate}<br>
                        ${time} (Horario de Brasilia)
                      </p>
                    </div>
                    
                    ${data.attendees && data.attendees.length > 0 ? `
                    <!-- Attendees -->
                    <div style="margin-top: 16px;">
                      <span style="color: #6B5B4F; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Participantes</span>
                      <div style="margin-top: 8px;">
                        ${data.attendees.map(a => `
                          <div style="color: #6B5B4F; font-size: 14px; margin-bottom: 4px;">
                            ${a.name}${a.email ? ` <span style="color: #5A4D42;">(${a.email})</span>` : ''}
                          </div>
                        `).join('')}
                      </div>
                    </div>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Message -->
          <tr>
            <td style="padding: 32px 24px;">
              <p style="color: #FAFAF9; font-size: 15px; margin: 0 0 16px 0; line-height: 1.5;">
                ${context.greeting},
              </p>
              <p style="color: #8C7A6E; font-size: 14px; margin: 0; line-height: 1.5;">
                Sua reuniao foi cancelada conforme solicitado.<br><br>
                Se voce quiser reagendar, e so entrar em contato conosco novamente.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 24px; border-top: 1px solid #262220;">
              <p style="color: #6B5B4F; font-size: 12px; margin: 0; text-align: center;">
                ${data.companyName ? `${new Date().getFullYear()} ${data.companyName}` : 'Agendamento automatico'}
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Generate reschedule email HTML
function generateRescheduleEmail(data: AppointmentEmailRequest): string {
  const calendar = formatCalendarBlock(data.startTime);
  const fullDate = formatFullDate(data.startTime);
  const time = formatTime(data.startTime);
  const endTime = data.endTime ? formatTime(data.endTime) : null;
  const context = getRecipientContext(data);
  
  // Old appointment info
  const oldFullDate = data.oldStartTime ? formatFullDate(data.oldStartTime) : null;
  const oldTime = data.oldStartTime ? formatTime(data.oldStartTime) : null;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reuniao Reagendada</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0D0B0A; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #0D0B0A;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #161311; border-radius: 16px; overflow: hidden; border: 1px solid #262220;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px 24px 16px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <span style="display: inline-block; padding: 6px 12px; background: rgba(61, 97, 255, 0.15); border: 1px solid rgba(61, 97, 255, 0.3); border-radius: 20px; color: #3D61FF; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
                      Reuniao Reagendada
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          ${oldFullDate && oldTime ? `
          <!-- Old Date (cancelled) -->
          <tr>
            <td style="padding: 0 24px 16px 24px;">
              <div style="background: rgba(61, 40, 40, 0.5); border: 1px solid #3D2828; border-radius: 8px; padding: 12px 16px;">
                <span style="color: #6B5B4F; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Data Anterior</span>
                <p style="color: #6B5B4F; margin: 4px 0 0 0; font-size: 14px; text-decoration: line-through;">
                  ${oldFullDate} as ${oldTime}
                </p>
              </div>
            </td>
          </tr>
          ` : ''}
          
          <!-- New Date Content -->
          <tr>
            <td style="padding: 0 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <!-- Calendar Block -->
                  <td width="100" style="vertical-align: top; padding-right: 20px;">
                    <div style="background: #0D0B0A; border-radius: 12px; text-align: center; overflow: hidden; border: 1px solid #262220;">
                      <div style="background: #3D61FF; color: #FFFFFF; padding: 8px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                        ${calendar.month}
                      </div>
                      <div style="padding: 16px 12px;">
                        <div style="font-size: 42px; font-weight: 700; color: #FAFAF9; line-height: 1;">${calendar.day}</div>
                        <div style="font-size: 13px; color: #8C7A6E; margin-top: 4px; font-weight: 500;">${calendar.dayName}</div>
                      </div>
                    </div>
                  </td>
                  
                  <!-- Event Details -->
                  <td style="vertical-align: top;">
                    <!-- New Label -->
                    <span style="display: inline-block; padding: 2px 8px; background: rgba(34, 197, 94, 0.15); border-radius: 4px; color: #22C55E; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-bottom: 8px;">
                      Nova Data
                    </span>
                    
                    <!-- Title -->
                    <h2 style="color: #FAFAF9; margin: 0 0 8px 0; font-size: 20px; font-weight: 600; line-height: 1.3;">
                      ${data.appointmentTitle}
                    </h2>
                    
                    ${data.meetingLink ? `
                    <a href="${data.meetingLink}" style="color: #3D61FF; font-size: 14px; text-decoration: none; font-weight: 500;">
                      Entrar na reuniao
                    </a>
                    ` : ''}
                    
                    <!-- When -->
                    <div style="margin-top: 20px;">
                      <span style="color: #8C7A6E; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Quando</span>
                      <p style="color: #FAFAF9; margin: 6px 0 0 0; font-size: 15px; line-height: 1.4;">
                        ${fullDate}<br>
                        ${time}${endTime ? ` - ${endTime}` : ''} (Horario de Brasilia)
                      </p>
                    </div>
                    
                    ${data.assigneeName && data.recipientType === 'contact' ? `
                    <!-- Who -->
                    <div style="margin-top: 16px;">
                      <span style="color: #8C7A6E; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Com Quem</span>
                      <p style="color: #FAFAF9; margin: 6px 0 0 0; font-size: 15px;">
                        ${data.assigneeName}
                      </p>
                    </div>
                    ` : ''}
                    
                    ${data.attendees && data.attendees.length > 0 ? `
                    <!-- Attendees -->
                    <div style="margin-top: 16px;">
                      <span style="color: #8C7A6E; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Participantes</span>
                      <div style="margin-top: 8px;">
                        ${data.attendees.map(a => `
                          <div style="color: #FAFAF9; font-size: 14px; margin-bottom: 4px;">
                            ${a.name}${a.email ? ` <span style="color: #8C7A6E;">(${a.email})</span>` : ''}
                          </div>
                        `).join('')}
                      </div>
                    </div>
                    ` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Meeting Link Button -->
          ${data.meetingLink ? `
          <tr>
            <td align="center" style="padding: 32px 24px;">
              <a href="${data.meetingLink}" style="display: inline-block; background: #3D61FF; color: #FFFFFF; padding: 16px 40px; border-radius: 10px; font-weight: 600; text-decoration: none; font-size: 15px; box-shadow: 0 4px 14px rgba(61, 97, 255, 0.3);">
                Entrar na Reuniao
              </a>
            </td>
          </tr>
          ` : ''}
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 0 24px 24px 24px;">
              <p style="color: #8C7A6E; font-size: 14px; margin: 0; line-height: 1.5;">
                ${context.greeting},<br><br>
                Sua reuniao foi reagendada com sucesso para a nova data acima. Voce recebera um lembrete antes do horario marcado.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 24px; border-top: 1px solid #262220;">
              <p style="color: #6B5B4F; font-size: 12px; margin: 0; text-align: center;">
                ${data.companyName ? `${new Date().getFullYear()} ${data.companyName}` : 'Agendamento automatico'}
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

// Get subject based on recipient type
function getSubject(data: AppointmentEmailRequest, formattedDate: string): string {
  const recipientType = data.recipientType || "contact";
  
  switch (data.type) {
    case "confirmation":
      switch (recipientType) {
        case "assignee":
          return `Nova Reuniao: ${data.appointmentTitle} com ${data.leadName || 'Cliente'} - ${formattedDate}`;
        case "creator":
          return `Reuniao Agendada: ${data.appointmentTitle} - ${formattedDate}`;
        default:
          return `Reuniao Confirmada: ${data.appointmentTitle} - ${formattedDate}`;
      }
    case "cancellation":
      return `Reuniao Cancelada: ${data.appointmentTitle}`;
    case "reschedule":
      return `Reuniao Reagendada: ${data.appointmentTitle} - ${formattedDate}`;
    default:
      return `Atualizacao de Reuniao: ${data.appointmentTitle}`;
  }
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: AppointmentEmailRequest = await req.json();
    const companyId = data.company_id || data.companyId;

    console.log("[EMAIL] Received request:", {
      type: data.type,
      email: data.email,
      title: data.appointmentTitle,
      recipientType: data.recipientType || 'contact',
      companyId,
    });

    if (!data.email) {
      console.log("[EMAIL] No email provided, skipping");
      return new Response(JSON.stringify({ success: false, error: "No email provided" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!companyId) {
      console.log("[EMAIL] Missing company_id, skipping email");
      return new Response(
        JSON.stringify({ success: false, error: "company_id obrigatorio", code: "missing_company_id" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    let creds;
    try {
      creds = await getResendKey(companyId);
    } catch (err) {
      const payload = resendErrorResponse(err);
      console.log(`[EMAIL] Resend not available for company ${companyId}: ${payload.error}`);
      return new Response(
        JSON.stringify({ success: false, ...payload }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const resend = new Resend(creds.apiKey);
    const from = resolveFromAddress(creds.fromEmail, data.companyName || "Agendamento");
    if (!from) {
      console.log(`[EMAIL] Missing sender domain for company ${companyId}`);
      return new Response(
        JSON.stringify({ success: false, error: RESEND_FROM_NOT_CONFIGURED, code: "resend_from_not_configured" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }


    let html: string;
    const formattedDate = formatFullDate(data.startTime);
    const useCustom = data.type === "confirmation"
      && (data.recipientType || "contact") === "contact"
      && (data.customBody || data.customSubject);
    const subject = useCustom && data.customSubject
      ? data.customSubject
      : getSubject(data, formattedDate);

    if (useCustom && data.customBody) {
      const safeBody = data.customBody
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>");
      html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f6f8fb;font-family:Arial,sans-serif;color:#1a1a1a">
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
          <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
            <tr><td style="font-size:15px;line-height:1.6;color:#1a1a1a">${safeBody}</td></tr>
          </table>
        </td></tr></table></body></html>`;
    } else {
      switch (data.type) {
        case "confirmation":
          html = generateConfirmationEmail(data);
          break;
        case "cancellation":
          html = generateCancellationEmail(data);
          break;
        case "reschedule":
          html = generateRescheduleEmail(data);
          break;
        default:
          console.error("[EMAIL] Unknown email type:", data.type);
          return new Response(JSON.stringify({ success: false, error: "Unknown email type" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          });
      }
    }


    console.log("[EMAIL] Sending email to:", data.email, "Subject:", subject, "From:", from);

    const emailResponse = await resend.emails.send({
      from,
      to: [data.email],
      subject,
      html,
    });

    console.log("[EMAIL] Email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, ...emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[EMAIL] Error in send-appointment-email function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
