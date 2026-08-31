import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const callId = url.searchParams.get("call_id");
    if (!callId) {
      return new Response(JSON.stringify({ error: "call_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch via user client so RLS enforces access
    const { data: call, error } = await userClient.from("calls").select("record_url").eq("id", callId).single();
    if (error || !call?.record_url) {
      return new Response(JSON.stringify({ error: "Call or audio not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const range = req.headers.get("range");
    const upstreamHeaders: HeadersInit = {};
    if (range) upstreamHeaders["range"] = range;

    const upstream = await fetch(call.record_url, { headers: upstreamHeaders });
    if (upstream.status === 404) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (!upstream.ok) {
      const details = await upstream.text().catch(() => "");
      return new Response(JSON.stringify({ error: "Failed to fetch audio", details: details || undefined }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
    const cl = upstream.headers.get("content-length"); if (cl) headers.set("content-length", cl);
    const cr = upstream.headers.get("content-range"); if (cr) headers.set("content-range", cr);
    const ar = upstream.headers.get("accept-ranges"); if (ar) headers.set("accept-ranges", ar);

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    console.error("[api4com-audio-proxy] error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
