import { useEffect, useState } from "react";
import { db, supabase } from "@/lib/recon/db";

/**
 * Set of company ids where the signed-in user is an owner or admin.
 * Used to hide integration setup controls from ordinary members (the database
 * rules and the server functions enforce the same restriction).
 */
export function useAdminCompanies() {
  const [adminCompanies, setAdminCompanies] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id;
      if (!uid) {
        if (!cancelled) setLoaded(true);
        return;
      }
      const { data } = await db.from("company_members").select("company_id, role").eq("user_id", uid);
      if (cancelled) return;
      const rows = (data ?? []) as { company_id: string; role: string }[];
      setAdminCompanies(
        new Set(rows.filter((r) => r.role === "owner" || r.role === "admin").map((r) => r.company_id)),
      );
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { adminCompanies, loaded, isAdmin: (companyId?: string | null) => !!companyId && adminCompanies.has(companyId) };
}
