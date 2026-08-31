import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MergeResult {
  groups_found: number;
  contacts_merged: number;
  contacts_deactivated: number;
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { company_id } = await req.json();
    if (!company_id) {
      return new Response(JSON.stringify({ error: "company_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all workspace IDs for this company
    const { data: workspaces, error: wsErr } = await supabase
      .from("workspaces")
      .select("id")
      .eq("company_id", company_id);

    if (wsErr) throw wsErr;
    const workspaceIds = workspaces.map((w: { id: string }) => w.id);

    if (workspaceIds.length === 0) {
      return new Response(JSON.stringify({ groups_found: 0, contacts_merged: 0, contacts_deactivated: 0, errors: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all active contacts across company workspaces
    const { data: contacts, error: cErr } = await supabase
      .from("crm_contacts")
      .select("*")
      .in("workspace_id", workspaceIds)
      .neq("is_active", false)
      .order("created_at", { ascending: true });

    if (cErr) throw cErr;

    // Group by phone and email
    const phoneGroups = new Map<string, typeof contacts>();
    const emailGroups = new Map<string, typeof contacts>();

    for (const c of contacts) {
      if (c.phone && c.phone.trim() !== "") {
        const key = c.phone.trim();
        if (!phoneGroups.has(key)) phoneGroups.set(key, []);
        phoneGroups.get(key)!.push(c);
      }
      if (c.email && c.email.trim() !== "") {
        const key = c.email.trim().toLowerCase();
        if (!emailGroups.has(key)) emailGroups.set(key, []);
        emailGroups.get(key)!.push(c);
      }
    }

    // Build unified duplicate groups (merge phone and email groups)
    // Use union-find to connect contacts that share phone OR email
    const contactMap = new Map<string, (typeof contacts)[0]>();
    const parent = new Map<string, string>();

    for (const c of contacts) {
      contactMap.set(c.id, c);
      parent.set(c.id, c.id);
    }

    function find(x: string): string {
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    }

    function union(a: string, b: string) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) {
        // Keep the older contact as root
        const ca = contactMap.get(ra)!, cb = contactMap.get(rb)!;
        if (new Date(ca.created_at) <= new Date(cb.created_at)) {
          parent.set(rb, ra);
        } else {
          parent.set(ra, rb);
        }
      }
    }

    // Union contacts sharing phone
    for (const group of phoneGroups.values()) {
      if (group.length > 1) {
        for (let i = 1; i < group.length; i++) {
          union(group[0].id, group[i].id);
        }
      }
    }

    // Union contacts sharing email
    for (const group of emailGroups.values()) {
      if (group.length > 1) {
        for (let i = 1; i < group.length; i++) {
          union(group[0].id, group[i].id);
        }
      }
    }

    // Build final groups (only groups with 2+ contacts)
    const groups = new Map<string, string[]>();
    for (const c of contacts) {
      const root = find(c.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(c.id);
    }

    const result: MergeResult = { groups_found: 0, contacts_merged: 0, contacts_deactivated: 0, errors: [] };

    for (const [rootId, memberIds] of groups) {
      if (memberIds.length < 2) continue;
      result.groups_found++;

      // Sort by created_at ascending — winner is the oldest
      const members = memberIds.map((id) => contactMap.get(id)!).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      const winner = members[0];
      const losers = members.slice(1);

      try {
        // Merge data from losers into winner (fill empty fields)
        const updates: Record<string, unknown> = {};
        const fillFields = ["email", "phone", "company", "job_title", "position", "revenue", "employee_count", "source", "dnia_id"];

        for (const field of fillFields) {
          if (!winner[field] || winner[field] === "") {
            for (const loser of losers) {
              if (loser[field] && loser[field] !== "") {
                updates[field] = loser[field];
                break;
              }
            }
          }
        }

        // Merge notes
        const allNotes = [winner.notes, ...losers.map((l: { notes: string | null }) => l.notes)].filter(Boolean);
        if (allNotes.length > 1) {
          updates.notes = allNotes.join("\n---\n");
        }

        // Merge tags (JSONB arrays)
        try {
          const allTags: { name: string; color: string }[] = [];
          const tagNames = new Set<string>();
          for (const m of members) {
            if (Array.isArray(m.tags)) {
              for (const t of m.tags) {
                if (t && t.name && !tagNames.has(t.name)) {
                  tagNames.add(t.name);
                  allTags.push(t);
                }
              }
            }
          }
          if (allTags.length > 0) {
            updates.tags = allTags;
          }
        } catch {
          // ignore tag merge errors
        }

        // Merge custom_fields
        try {
          let mergedCustom = winner.custom_fields && typeof winner.custom_fields === "object" ? { ...winner.custom_fields } : {};
          for (const loser of losers) {
            if (loser.custom_fields && typeof loser.custom_fields === "object") {
              for (const [k, v] of Object.entries(loser.custom_fields as Record<string, unknown>)) {
                if (!(k in mergedCustom) || !mergedCustom[k]) {
                  mergedCustom[k] = v;
                }
              }
            }
          }
          if (Object.keys(mergedCustom).length > 0) {
            updates.custom_fields = mergedCustom;
          }
        } catch {
          // ignore
        }

        // Update winner with merged data (if any updates)
        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString();
          const { error: upErr } = await supabase
            .from("crm_contacts")
            .update(updates)
            .eq("id", winner.id);
          if (upErr) {
            result.errors.push(`Update winner ${winner.id}: ${upErr.message}`);
          }
        }

        // Reassign FKs from losers to winner
        const loserIds = losers.map((l: { id: string }) => l.id);

        const fkUpdates = [
          supabase.from("crm_leads").update({ contact_id: winner.id }).in("contact_id", loserIds),
          supabase.from("crm_appointments").update({ contact_id: winner.id }).in("contact_id", loserIds),
          supabase.from("leads").update({ contact_id: winner.id }).in("contact_id", loserIds),
          supabase.from("meta_capi_events").update({ contact_id: winner.id }).in("contact_id", loserIds),
        ];

        const fkResults = await Promise.all(fkUpdates);
        for (const r of fkResults) {
          if (r.error) {
            result.errors.push(`FK reassign: ${r.error.message}`);
          }
        }

        // Deactivate losers
        const { error: deactErr } = await supabase
          .from("crm_contacts")
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .in("id", loserIds);

        if (deactErr) {
          result.errors.push(`Deactivate: ${deactErr.message}`);
        } else {
          result.contacts_deactivated += loserIds.length;
        }

        result.contacts_merged += members.length;
      } catch (err) {
        result.errors.push(`Group ${rootId}: ${err.message}`);
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
