import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    console.log("[ZAPI-VALIDATE] Body recebido:", JSON.stringify(body));

    const { client_token } = body;

    if (!client_token) {
      console.log("[ZAPI-VALIDATE] client_token ausente no body");
      return new Response(
        JSON.stringify({ valid: false, error: "Parametro obrigatorio: client_token" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[ZAPI-VALIDATE] Token recebido, tamanho:", client_token.length);
    console.log("[ZAPI-VALIDATE] Chamando GET https://api.z-api.io/instances?page=1&pageSize=1");

    const response = await fetch("https://api.z-api.io/instances?page=1&pageSize=1", {
      method: "GET",
      headers: {
        "Client-Token": client_token,
      },
    });

    const responseText = await response.text();
    console.log("[ZAPI-VALIDATE] Z-API status:", response.status);
    console.log("[ZAPI-VALIDATE] Z-API response body:", responseText);

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { error: responseText };
    }

    if (!response.ok) {
      return new Response(
        JSON.stringify({ valid: false, error: result.error || `HTTP ${response.status}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ valid: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[ZAPI-VALIDATE] Error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
