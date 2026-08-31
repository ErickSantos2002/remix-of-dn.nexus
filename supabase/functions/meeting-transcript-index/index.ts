// Edge function: meeting-transcript-index
// Recebe um chunk da transcrição da reunião ao vivo, gera embedding via
// Lovable AI Gateway e armazena em meeting_transcript_chunks para uso em RAG.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface RequestBody {
  workspace_id: string;
  meeting_id: string;
  chunk_index: number;
  start_ts: string;
  end_ts: string;
  speakers: string[];
  content: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    if (
      !body?.workspace_id ||
      !body?.meeting_id ||
      typeof body?.chunk_index !== "number" ||
      !body?.start_ts ||
      !body?.end_ts ||
      !body?.content
    ) {
      return json({ error: "invalid_payload" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "ai_not_configured" }, 500);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Gera embedding
    const embResp = await fetch(
      "https://ai.gateway.lovable.dev/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-embedding-001",
          input: body.content.slice(0, 8000),
        }),
      },
    );

    if (!embResp.ok) {
      const text = await embResp.text();
      console.error(
        "[meeting-transcript-index] embedding error",
        embResp.status,
        text,
      );
      return json({ error: "embedding_failed" }, 500);
    }

    const embData = await embResp.json();
    const embedding = embData?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      return json({ error: "no_embedding" }, 500);
    }

    const insertPromise = admin
      .from("meeting_transcript_chunks")
      .upsert(
        {
          workspace_id: body.workspace_id,
          meeting_id: body.meeting_id,
          chunk_index: body.chunk_index,
          start_ts: body.start_ts,
          end_ts: body.end_ts,
          speakers: body.speakers ?? [],
          content: body.content,
          embedding: embedding as unknown as string,
        },
        { onConflict: "meeting_id,chunk_index", ignoreDuplicates: true },
      )
      .then(({ error }) => {
        if (error) {
          console.error("[meeting-transcript-index] upsert error", error);
        }
      });


    // @ts-ignore EdgeRuntime no Deno
    EdgeRuntime.waitUntil(insertPromise);

    return json({ ok: true });
  } catch (err) {
    console.error("[meeting-transcript-index] fatal", err);
    return json({ error: "internal_error", message: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
