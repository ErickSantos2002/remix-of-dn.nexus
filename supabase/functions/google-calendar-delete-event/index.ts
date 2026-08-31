import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getGoogleCredentials,
  googleOAuthErrorResponse,
  GoogleOAuthError,
} from "../_shared/googleCredentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteEventRequest {
  workspace_id: string;
  appointment_id?: string;
  google_event_id?: string;
  calendar_owner_id?: string;
}

async function refreshAccessToken(
  refreshToken: string,
  workspaceId: string,
): Promise<{ access_token: string; expires_at: string } | null> {
  const { clientId, clientSecret } = await getGoogleCredentials(workspaceId);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) {
      console.error('[google-calendar-delete-event] Failed to refresh token:', await response.text());
      return null;
    }
    const tokens = await response.json();
    return {
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    console.error('[google-calendar-delete-event] Error refreshing token:', error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const body: DeleteEventRequest = await req.json();
    const { workspace_id, appointment_id, calendar_owner_id } = body;
    let { google_event_id } = body;

    console.log(`[google-calendar-delete-event] workspace=${workspace_id} appointment=${appointment_id} event=${google_event_id} owner=${calendar_owner_id || 'fallback'}`);

    // Determine calendar owner and event id
    let calendarUserId = calendar_owner_id;

    if ((!calendarUserId || !google_event_id) && appointment_id) {
      const { data: appointment, error: appointmentError } = await supabase
        .from('crm_appointments')
        .select('assigned_to, google_event_id')
        .eq('id', appointment_id)
        .single();

      if (appointmentError || !appointment) {
        console.log('[google-calendar-delete-event] Appointment not found:', appointmentError?.message);
        return new Response(
          JSON.stringify({ success: false, error: 'Appointment not found' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!calendarUserId) calendarUserId = appointment.assigned_to ?? undefined;
      if (!google_event_id) google_event_id = appointment.google_event_id ?? undefined;
    }

    if (!google_event_id) {
      console.log('[google-calendar-delete-event] No google_event_id available, nothing to delete');
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: 'no_google_event_id' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!calendarUserId) {
      console.log('[google-calendar-delete-event] No calendar user available');
      return new Response(
        JSON.stringify({ success: false, error: 'No calendar owner available' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get integration
    const { data: integration, error: intError } = await supabase
      .from('crm_google_calendar_integration')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('user_id', calendarUserId)
      .eq('is_enabled', true)
      .single();

    if (intError || !integration) {
      console.log('[google-calendar-delete-event] No Google Calendar integration found for user:', calendarUserId);
      return new Response(
        JSON.stringify({ success: false, error: 'Google Calendar integration not found or disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Refresh token if expired
    let accessToken = integration.google_access_token;
    if (new Date(integration.token_expires_at) <= new Date()) {
      console.log('[google-calendar-delete-event] Token expired, refreshing...');
      const refreshed = await refreshAccessToken(integration.google_refresh_token, workspace_id);
      if (!refreshed) {
        throw new Error('Failed to refresh Google access token');
      }
      await supabase
        .from('crm_google_calendar_integration')
        .update({
          google_access_token: refreshed.access_token,
          token_expires_at: refreshed.expires_at,
        })
        .eq('id', integration.id);
      accessToken = refreshed.access_token;
    }

    const calendarId = integration.google_calendar_id || 'primary';

    console.log(`[google-calendar-delete-event] Deleting event ${google_event_id} from calendar ${calendarId}`);

    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(google_event_id)}?sendUpdates=all`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    // 200/204 = success, 404/410 = already gone (idempotent success)
    if (!calendarResponse.ok && calendarResponse.status !== 404 && calendarResponse.status !== 410) {
      const errorText = await calendarResponse.text();
      console.error(`[google-calendar-delete-event] Failed to delete event [${calendarResponse.status}]:`, errorText);
      throw new Error(`Failed to delete calendar event [${calendarResponse.status}]: ${errorText}`);
    }

    if (calendarResponse.status === 404 || calendarResponse.status === 410) {
      console.log('[google-calendar-delete-event] Event already gone in Google, treating as success');
    } else {
      console.log('[google-calendar-delete-event] Event deleted successfully');
    }

    // Update last sync time
    await supabase
      .from('crm_google_calendar_integration')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', integration.id);

    return new Response(
      JSON.stringify({
        success: true,
        google_event_id,
        calendar_owner_id: calendarUserId,
        already_gone: calendarResponse.status === 404 || calendarResponse.status === 410,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[google-calendar-delete-event] Error:', error);
    if (error instanceof GoogleOAuthError) {
      return new Response(
        JSON.stringify({ success: false, ...googleOAuthErrorResponse(error) }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
