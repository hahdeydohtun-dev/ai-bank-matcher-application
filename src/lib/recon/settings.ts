import { useCallback, useEffect, useRef, useState } from "react";
import { db, supabase } from "./db";

export type ThemeKey = "navy" | "midnight" | "slate" | "light";

export type ReconSettings = {
  theme: ThemeKey;
  density: "comfortable" | "compact";
  autoThreshold: number;
  reviewThreshold: number;
  highValueThreshold: number;
  agingDays: number;
  bankChargeAutoMatch: boolean;
  bankChargeKeywords: string[];
  chargeTolerance: number;
  liveSync: boolean;
  showAiPanel: boolean;
  confirmDestructive: boolean;
  defaultView: "list" | "board";
  pageSize: number;
  apiIntegrationEnabled: boolean;
  erpApiIntegrationEnabled: boolean;
};

export const DEFAULT_SETTINGS: ReconSettings = {
  theme: "navy",
  density: "comfortable",
  autoThreshold: 85,
  reviewThreshold: 60,
  highValueThreshold: 3_000_000,
  agingDays: 14,
  bankChargeAutoMatch: true,
  bankChargeKeywords: [
    "CHARGE",
    "CHARGES",
    "COMMISSION",
    "COT",
    "VAT",
    "STAMP DUTY",
    "SMS ALERT",
    "MAINTENANCE FEE",
    "TRANSFER FEE",
    "LEVY",
    "NIP FEE",
    "BANK FEE",
  ],
  chargeTolerance: 2,
  liveSync: true,
  showAiPanel: true,
  confirmDestructive: true,
  defaultView: "list",
  pageSize: 200,
  apiIntegrationEnabled: false,
  erpApiIntegrationEnabled: false,
};

/**
 * Fields in this list are the reconciliation-relevant config that a whole
 * company should share (matching thresholds, bank-charge rules, which
 * integrations are turned on). These sync through the `company_settings`
 * table so every teammate sees the same values and a change one person
 * makes shows up live for everyone else on that company.
 *
 * Everything else in ReconSettings (theme, density, default view, page
 * size...) is a personal display preference and stays in localStorage —
 * there's no reason to force it on your teammates.
 */
const COMPANY_FIELDS = [
  "autoThreshold",
  "reviewThreshold",
  "highValueThreshold",
  "agingDays",
  "bankChargeAutoMatch",
  "bankChargeKeywords",
  "chargeTolerance",
] as const satisfies readonly (keyof ReconSettings)[];

type CompanyField = (typeof COMPANY_FIELDS)[number];

function isCompanyField(key: string): key is CompanyField {
  return (COMPANY_FIELDS as readonly string[]).includes(key);
}

const LOCAL_KEY = "recon.settings.local.v2";
const LOCAL_EVENT = "recon-local-settings-change";

type LocalSettings = Omit<ReconSettings, CompanyField>;

function loadLocalSettings(): LocalSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<LocalSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLocalSettings(next: LocalSettings) {
  window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: next }));
}

export function applyTheme(settings: Pick<ReconSettings, "theme" | "density">) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
}

type CompanySettingsRow = {
  auto_threshold: number;
  review_threshold: number;
  high_value_threshold: number;
  aging_days: number;
  bank_charge_auto_match: boolean;
  bank_charge_keywords: string[];
  charge_tolerance: number;
};

function rowToCompanyFields(row: CompanySettingsRow | null): Pick<ReconSettings, CompanyField> {
  if (!row) {
    const {
      autoThreshold,
      reviewThreshold,
      highValueThreshold,
      agingDays,
      bankChargeAutoMatch,
      bankChargeKeywords,
      chargeTolerance,
    } = DEFAULT_SETTINGS;
    return {
      autoThreshold,
      reviewThreshold,
      highValueThreshold,
      agingDays,
      bankChargeAutoMatch,
      bankChargeKeywords,
      chargeTolerance,
    };
  }
  return {
    autoThreshold: Number(row.auto_threshold),
    reviewThreshold: Number(row.review_threshold),
    highValueThreshold: Number(row.high_value_threshold),
    agingDays: Number(row.aging_days),
    bankChargeAutoMatch: row.bank_charge_auto_match,
    bankChargeKeywords: row.bank_charge_keywords ?? DEFAULT_SETTINGS.bankChargeKeywords,
    chargeTolerance: Number(row.charge_tolerance),
  };
}

function companyFieldsToRow(fields: Partial<Pick<ReconSettings, CompanyField>>) {
  const row: Record<string, unknown> = {};
  if (fields.autoThreshold !== undefined) row.auto_threshold = fields.autoThreshold;
  if (fields.reviewThreshold !== undefined) row.review_threshold = fields.reviewThreshold;
  if (fields.highValueThreshold !== undefined) row.high_value_threshold = fields.highValueThreshold;
  if (fields.agingDays !== undefined) row.aging_days = fields.agingDays;
  if (fields.bankChargeAutoMatch !== undefined)
    row.bank_charge_auto_match = fields.bankChargeAutoMatch;
  if (fields.bankChargeKeywords !== undefined) row.bank_charge_keywords = fields.bankChargeKeywords;
  if (fields.chargeTolerance !== undefined) row.charge_tolerance = fields.chargeTolerance;
  return row;
}

/**
 * Reactive settings hook. `companyId` selects which company's shared
 * matching config to load/sync — pass "" while a company hasn't been
 * picked yet and the hook will just serve local defaults for those fields
 * until one is available.
 */
export function useSettings(
  companyId: string,
): [ReconSettings, (patch: Partial<ReconSettings>) => void, () => void] {
  const [local, setLocal] = useState<LocalSettings>(DEFAULT_SETTINGS);
  const [companyFields, setCompanyFields] = useState<Pick<ReconSettings, CompanyField>>(
    rowToCompanyFields(null),
  );
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;

  // Local (personal) half — unchanged localStorage behavior.
  useEffect(() => {
    const initial = loadLocalSettings();
    setLocal(initial);
    applyTheme(initial);
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<LocalSettings>).detail;
      setLocal(next);
      applyTheme(next);
    };
    window.addEventListener(LOCAL_EVENT, onChange);
    return () => window.removeEventListener(LOCAL_EVENT, onChange);
  }, []);

  // Company (shared) half — loaded from and synced to company_settings.
  useEffect(() => {
    if (!companyId) {
      setCompanyFields(rowToCompanyFields(null));
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await db
        .from("company_settings")
        .select("*")
        .eq("company_id", companyId)
        .maybeSingle();
      if (!cancelled) setCompanyFields(rowToCompanyFields((data as CompanySettingsRow) ?? null));
    })();

    const channel = supabase
      .channel(`company-settings-${companyId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "company_settings",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const row = (payload.new ?? null) as CompanySettingsRow | null;
          setCompanyFields(rowToCompanyFields(row));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [companyId]);

  const update = useCallback((patch: Partial<ReconSettings>) => {
    const localPatch: Partial<LocalSettings> = {};
    const companyPatch: Partial<Pick<ReconSettings, CompanyField>> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (isCompanyField(key)) (companyPatch as Record<string, unknown>)[key] = value;
      else (localPatch as Record<string, unknown>)[key] = value;
    }

    if (Object.keys(localPatch).length) {
      const next = { ...loadLocalSettings(), ...localPatch };
      saveLocalSettings(next);
      setLocal(next);
      applyTheme(next);
    }

    if (Object.keys(companyPatch).length) {
      setCompanyFields((prev) => ({ ...prev, ...companyPatch }));
      const cid = companyIdRef.current;
      if (cid) {
        void db.from("company_settings").upsert(
          {
            company_id: cid,
            ...companyFieldsToRow(companyPatch),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id" },
        );
      }
    }
  }, []);

  const reset = useCallback(() => {
    saveLocalSettings(DEFAULT_SETTINGS);
    setLocal(DEFAULT_SETTINGS);
    applyTheme(DEFAULT_SETTINGS);
    setCompanyFields(rowToCompanyFields(null));
    const cid = companyIdRef.current;
    if (cid) {
      void db.from("company_settings").upsert(
        {
          company_id: cid,
          ...companyFieldsToRow(rowToCompanyFields(null)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" },
      );
    }
  }, []);

  return [{ ...local, ...companyFields }, update, reset];
}
