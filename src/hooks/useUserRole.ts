import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type AppRole = "super_admin" | "admin" | "member";

const ROLE_PRECEDENCE: AppRole[] = ["super_admin", "admin", "member"];

export function useUserRole() {
  const [role, setRole] = useState<AppRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRole() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          setIsLoading(false);
          return;
        }

        setUserId(user.id);

        // user_roles admite mais de uma linha por usuário (UNIQUE em user_id+role),
        // então lemos todas e ficamos com a de maior privilégio.
        const { data, error } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id);

        if (error) {
          console.error("Error fetching role:", error);
          setRole("member"); // Default role
        } else {
          const roles = (data ?? []).map((r) => r.role as AppRole);
          const highest = ROLE_PRECEDENCE.find((r) => roles.includes(r));
          setRole(highest ?? "member");
        }
      } catch (error) {
        console.error("Error:", error);
        setRole("member");
      } finally {
        setIsLoading(false);
      }
    }

    fetchRole();
  }, []);

  const isSuperAdmin = role === "super_admin";
  const isAdmin = role === "admin" || role === "super_admin";

  return { role, isLoading, isSuperAdmin, isAdmin, userId };
}
