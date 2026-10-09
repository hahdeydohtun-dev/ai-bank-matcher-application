import { Link } from "@tanstack/react-router";
import { Building2, ChevronDown, FileText, Landmark, LogOut, Settings2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ErpHeader({ email, live, liveEnabled, companyName, onSignOut }: {
  email: string; live: boolean; liveEnabled: boolean; companyName?: string; onSignOut: () => void;
}) {
  return <header className="border-b border-border bg-surface">
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-2">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><Landmark className="size-5" aria-hidden="true" /></div>
        <div><p className="text-sm font-semibold">AI Bank Matcher</p><p className="text-[11px] text-muted-foreground">Treasury Management</p></div>
        <span className="mx-2 hidden h-6 border-l border-border sm:block" />
        <p className="hidden text-xs text-muted-foreground sm:block">Accounting <span className="mx-2">/</span> <span className="text-foreground">Bank Reconciliation</span></p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex"><span className={`size-1.5 rounded-full ${live ? "bg-success" : "bg-muted-foreground"}`} />{live ? "Live sync" : liveEnabled ? "Connecting…" : "Live sync off"}</span>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="max-w-60"><UserRound /><span className="truncate">{email || "Account"}</span><ChevronDown /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuLabel>{companyName || "Workspace"}</DropdownMenuLabel><DropdownMenuItem asChild><Link to="/select-company" search={{ force: "1" }}><Building2 />Switch company</Link></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={onSignOut}><LogOut />Sign out</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    <nav aria-label="Accounting modules" className="flex items-center gap-5 overflow-x-auto border-t border-border px-5 text-xs">
      <Link to="/reconciliation" className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-primary font-semibold text-primary"><Landmark className="size-3.5" />Bank reconciliation</Link>
      <Link to="/reports" className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground"><FileText className="size-3.5" />Reconciliation reports</Link>
      <Link to="/control-panel" className="flex h-10 shrink-0 items-center gap-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground"><Settings2 className="size-3.5" />Control panel</Link>
    </nav>
  </header>;
}