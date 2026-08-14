import { useEffect, useState } from "react";
import { db, supabase, type CompanyInvite, type CompanyMember, type Profile } from "@/lib/recon/db";
import { toast } from "sonner";

const ROLES = [
  { key: "member", label: "Member" },
  { key: "admin", label: "Admin" },
];

export function TeamTab({ companyId }: { companyId: string }) {
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [invites, setInvites] = useState<CompanyInvite[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    const [memRes, invRes, userRes] = await Promise.all([
      db.from("company_members").select("*").eq("company_id", companyId),
      db
        .from("company_invites")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      supabase.auth.getUser(),
    ]);
    const memberRows = (memRes.data ?? []) as CompanyMember[];
    setMembers(memberRows);
    setInvites((invRes.data ?? []) as CompanyInvite[]);
    setSelfId(userRes.data.user?.id ?? null);

    const userIds = Array.from(new Set(memberRows.map((m) => m.user_id)));
    if (userIds.length) {
      const { data: profRows } = await db.from("profiles").select("*").in("id", userIds);
      setProfiles(Object.fromEntries(((profRows ?? []) as Profile[]).map((p) => [p.id, p])));
    } else {
      setProfiles({});
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  async function sendInvite() {
    const trimmed = inviteEmail.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    if (members.some((m) => profiles[m.user_id]?.email?.toLowerCase() === trimmed)) {
      setError("That person is already a member of this company.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user?.id) throw new Error("Not signed in.");
      const { error: err } = await db.from("company_invites").insert({
        company_id: companyId,
        email: trimmed,
        role: inviteRole,
        invited_by: userData.user.id,
      });
      if (err) {
        // Unique index only allows one *pending* invite per (company, email).
        if (err.message?.toLowerCase().includes("duplicate"))
          throw new Error("There's already a pending invite for that email.");
        throw err;
      }
      setInviteEmail("");
      toast.success(`Invite sent to ${trimmed}`, {
        description:
          "Copy the invite link below and share it — there's no outbound email yet in V1.",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send invite");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvite(id: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await db
      .from("company_invites")
      .update({ status: "revoked" })
      .eq("id", id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function changeRole(memberId: string, role: string) {
    setBusy(true);
    setError(null);
    const { error: err } = await db.rpc("set_company_member_role", {
      _member_id: memberId,
      _role: role,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function removeMember(member: CompanyMember) {
    const label = profiles[member.user_id]?.email ?? "this member";
    const isSelf = member.user_id === selfId;
    if (
      !window.confirm(
        isSelf
          ? "Leave this company? You'll lose access to its workspace immediately."
          : `Remove ${label} from this company?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const { error: err } = await db.from("company_members").delete().eq("id", member.id);
    setBusy(false);
    if (err) {
      setError(
        err.message.includes("last member")
          ? "Can't remove the last member of a company — delete the company instead."
          : err.message,
      );
      return;
    }
    await load();
  }

  function inviteLink(invite: CompanyInvite) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/accept-invite?token=${invite.token}`;
  }

  async function copyLink(invite: CompanyInvite) {
    try {
      await navigator.clipboard.writeText(inviteLink(invite));
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy — copy the link manually");
    }
  }

  if (!companyId) {
    return (
      <div className="panel p-6 text-center text-xs text-muted-foreground">
        Create a company first — team membership is scoped per-company.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <section className="panel p-4">
        <p className="caption">Invite a teammate</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="caption">Email</label>
            <input
              type="email"
              className="field mt-1"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
          </div>
          <div>
            <label className="caption">Role</label>
            <select
              className="field mt-1 w-32"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => void sendInvite()}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Invites expire after 14 days and only work for the exact email address invited. Share the
          link with your teammate — there's no outbound email yet in V1.
        </p>
      </section>

      {invites.length > 0 && (
        <section className="panel p-3">
          <p className="caption px-2 pt-1">Pending invites</p>
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="caption px-2 py-1.5">Email</th>
                <th className="caption px-2 py-1.5">Role</th>
                <th className="caption px-2 py-1.5">Expires</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id} className="border-b border-border align-top last:border-0">
                  <td className="px-2 py-1.5">{inv.email}</td>
                  <td className="px-2 py-1.5 capitalize">{inv.role}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => void copyLink(inv)}
                        className="rounded border border-border-strong px-2 py-0.5 text-[10px] hover:border-primary"
                      >
                        Copy link
                      </button>
                      <button
                        onClick={() => void revokeInvite(inv.id)}
                        disabled={busy}
                        className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel p-3">
        <p className="caption px-2 pt-1">Members</p>
        {loading ? (
          <div className="space-y-2 p-3">
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : members.length ? (
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="caption px-2 py-1.5">Email</th>
                <th className="caption px-2 py-1.5">Role</th>
                <th className="caption px-2 py-1.5">Member since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">
                    {profiles[m.user_id]?.email ?? m.user_id}
                    {m.user_id === selfId && (
                      <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        You
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className="field h-7 w-28 text-[11px] capitalize"
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void changeRole(m.id, e.target.value)}
                    >
                      {["owner", "admin", "member"].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground">
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() => void removeMember(m)}
                      disabled={busy}
                      className="rounded border border-destructive/40 px-2 py-0.5 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      {m.user_id === selfId ? "Leave" : "Remove"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">No members yet.</p>
        )}
      </section>
    </div>
  );
}
