import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  getGoogleCredentials,
  googleOAuthErrorResponse,
  GoogleOAuthError,
} from "../_shared/googleCredentials.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, code, workspace_id, user_id, redirect_uri, refresh_token } = body;

    console.log(`[google-calendar-auth] Action: ${action}, workspace_id: ${workspace_id}`);

    let clientId: string;
    let clientSecret: string;
    try {
      const creds = await getGoogleCredentials(workspace_id);
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
      console.log(`[google-calendar-auth] Using credentials from company: ${creds.companyId}`);
    } catch (err) {
      const payload = googleOAuthErrorResponse(err);
      console.warn(`[google-calendar-auth] Credentials error: ${payload.code} - ${payload.error}`);
      return new Response(
        JSON.stringify(payload),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'get_auth_url') {
      const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
      ].join(' ');

      const state = JSON.stringify({ workspace_id, user_id });
      const encodedState = btoa(state);

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&access_type=offline` +
        `&prompt=consent` +
        `&state=${encodedState}`;

      return new Response(
        JSON.stringify({ auth_url: authUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'exchange_code') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri,
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error(`[google-calendar-auth] Token exchange failed: ${error}`);
        throw new Error(`Token exchange failed: ${error}`);
      }

      const tokens = await tokenResponse.json();

      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const userInfo = await userInfoResponse.json();

      const calendarResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const calendar = await calendarResponse.json();

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      return new Response(
        JSON.stringify({
          success: true,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          email: userInfo.email,
          calendar_id: calendar.id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'refresh_token') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error(`[google-calendar-auth] Token refresh failed: ${error}`);
        throw new Error(`Token refresh failed: ${error}`);
      }

      const tokens = await tokenResponse.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      return new Response(
        JSON.stringify({
          success: true,
          access_token: tokens.access_token,
          expires_at: expiresAt,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error: unknown) {
    if (error instanceof GoogleOAuthError) {
      return new Response(
        JSON.stringify(googleOAuthErrorResponse(error)),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[google-calendar-auth] Error:`, msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
