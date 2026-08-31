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

interface CreateEventRequest {
  workspace_id: string;
  appointment_id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  attendee_email?: string;
  additional_attendees?: string[];
  calendar_owner_id?: string;
  create_meet_link?: boolean;
  notify_attendees?: boolean;
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
      console.error('Failed to refresh token:', await response.text());
      return null;
    }

    const tokens = await response.json();
    return {
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    };
  } catch (error) {
    console.error('Error refreshing token:', error);
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

    const body: CreateEventRequest = await req.json();
    const { 
      workspace_id, 
      appointment_id, 
      title, 
      description, 
      start_time, 
      end_time, 
      attendee_email,
      additional_attendees = [],
      calendar_owner_id,
      create_meet_link = true,
      notify_attendees = true
    } = body;

    console.log(`[google-calendar-create-event] Creating event for workspace: ${workspace_id}, appointment: ${appointment_id}`);
    console.log(`[google-calendar-create-event] Calendar owner ID override: ${calendar_owner_id || 'none (using assigned_to)'}`);

    // Determine which user's calendar to use
    let calendarUserId = calendar_owner_id;

    // If no calendar_owner_id provided, fall back to assigned_to from appointment
    if (!calendarUserId) {
      const { data: appointment, error: appointmentError } = await supabase
        .from('crm_appointments')
        .select('assigned_to')
        .eq('id', appointment_id)
        .single();

      if (appointmentError || !appointment) {
        console.log('[google-calendar-create-event] Appointment not found:', appointmentError?.message);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Appointment not found',
            meeting_link: null 
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      calendarUserId = appointment.assigned_to;
    }

    console.log(`[google-calendar-create-event] Using calendar of user: ${calendarUserId}`);

    if (!calendarUserId) {
      console.log('[google-calendar-create-event] No calendar user ID available');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Nenhum usuario selecionado para a agenda',
          meeting_link: null 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Google Calendar integration for the selected user
    const { data: integration, error: intError } = await supabase
      .from('crm_google_calendar_integration')
      .select('*')
      .eq('workspace_id', workspace_id)
      .eq('user_id', calendarUserId)
      .eq('is_enabled', true)
      .single();

    if (intError || !integration) {
      console.log('[google-calendar-create-event] No Google Calendar integration found for user:', calendarUserId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Usuario nao possui Google Calendar conectado',
          meeting_link: null 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if token needs refresh
    let accessToken = integration.google_access_token;
    if (new Date(integration.token_expires_at) <= new Date()) {
      console.log('[google-calendar-create-event] Token expired, refreshing...');
      const refreshed = await refreshAccessToken(integration.google_refresh_token, workspace_id);
      if (!refreshed) {
        throw new Error('Failed to refresh Google access token');
      }
      
      // Update tokens in database
      await supabase
        .from('crm_google_calendar_integration')
        .update({
          google_access_token: refreshed.access_token,
          token_expires_at: refreshed.expires_at,
        })
        .eq('id', integration.id);
      
      accessToken = refreshed.access_token;
    }

    // Create Google Calendar event
    const calendarId = integration.google_calendar_id || 'primary';
    
    const eventBody: any = {
      summary: title,
      description: description || '',
      start: {
        dateTime: start_time,
        timeZone: 'America/Sao_Paulo',
      },
      end: {
        dateTime: end_time,
        timeZone: 'America/Sao_Paulo',
      },
    };

    // Build attendees list
    const attendees: Array<{ email: string }> = [];
    
    // Add primary attendee (lead's email)
    if (attendee_email) {
      attendees.push({ email: attendee_email });
    }
    
    // Add additional attendees (assignee, creator, etc.)
    if (additional_attendees && additional_attendees.length > 0) {
      for (const email of additional_attendees) {
        if (email && !attendees.some(a => a.email === email)) {
          attendees.push({ email });
        }
      }
    }
    
    // Set attendees if any
    if (attendees.length > 0) {
      eventBody.attendees = attendees;
      console.log(`[google-calendar-create-event] Adding ${attendees.length} attendee(s):`, attendees.map(a => a.email).join(', '));
    }

    // Add Google Meet conference
    if (create_meet_link) {
      eventBody.conferenceData = {
        createRequest: {
          requestId: `meet-${appointment_id}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    console.log('[google-calendar-create-event] Creating event in Google Calendar...');
    
    const sendUpdates = notify_attendees ? 'all' : 'none';
    console.log(`[google-calendar-create-event] sendUpdates=${sendUpdates}`);

    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=${sendUpdates}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      }
    );

    if (!calendarResponse.ok) {
      const error = await calendarResponse.text();
      console.error('[google-calendar-create-event] Failed to create event:', error);
      throw new Error(`Failed to create calendar event: ${error}`);
    }

    const event = await calendarResponse.json();
    console.log(`[google-calendar-create-event] Event created: ${event.id}`);

    // Extract meeting link
    const meetingLink = event.conferenceData?.entryPoints?.find(
      (e: any) => e.entryPointType === 'video'
    )?.uri || null;

    // Update appointment with Google event ID and meeting link
    const updateData: any = {
      google_event_id: event.id,
      is_synced_to_google: true,
    };
    
    if (meetingLink) {
      updateData.meeting_link = meetingLink;
    }

    await supabase
      .from('crm_appointments')
      .update(updateData)
      .eq('id', appointment_id);

    // Update last sync time
    await supabase
      .from('crm_google_calendar_integration')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', integration.id);

    return new Response(
      JSON.stringify({
        success: true,
        event_id: event.id,
        google_event_id: event.id,
        meeting_link: meetingLink,
        event_link: event.htmlLink,
        calendar_owner_id: calendarUserId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[google-calendar-create-event] Error:', error);
    if (error instanceof GoogleOAuthError) {
      return new Response(
        JSON.stringify({ success: false, meeting_link: null, ...googleOAuthErrorResponse(error) }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        meeting_link: null
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
