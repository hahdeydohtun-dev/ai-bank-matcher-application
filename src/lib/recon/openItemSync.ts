import { db, type OpenItem } from "./db";

/**
 * Open items (unreconciled entries carried forward from a prior period) must
 * always appear in the matching workspace alongside the current period's
 * imports — until they get matched/reconciled.
 *
 * They are mirrored into `bank_transactions` / `accounting_records` with a
 * deterministic reference (`OPEN-<open_item_id>`) so every existing matching,
 * accept/reject and merge flow works on them unchanged. Mirroring is
 * idempotent: an item that already has a mirror row is never inserted twice,
 * and once its mirror is reconciled the open item itself is closed so it
 * stops being carried forward.
 */
export const OPEN_ITEM_REF_PREFIX = "OPEN-";

export function openItemRef(id: string) {
  return `${OPEN_ITEM_REF_PREFIX}${id}`;
}

export function isOpenItemRef(ref: string | null | undefined) {
  return !!ref && ref.startsWith(OPEN_ITEM_REF_PREFIX);
}

export async function syncOpenItems(companyId: string, accountId: string) {
  if (!companyId || !accountId) return;

  const { data } = await db
    .from("open_items")
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_account_id", accountId)
    .eq("status", "open");

  const items = (data ?? []) as OpenItem[];
  if (!items.length) return;

  const bankItems = items.filter((i) => i.source === "bank");
  const ledgerItems = items.filter((i) => i.source === "ledger");

  const [txnRes, recRes] = await Promise.all([
    bankItems.length
      ? db
          .from("bank_transactions")
          .select("id, txn_ref, status")
          .eq("company_id", companyId)
          .eq("bank_account_id", accountId)
          .in(
            "txn_ref",
            bankItems.map((i) => openItemRef(i.id)),
          )
      : Promise.resolve({ data: [] }),
    ledgerItems.length
      ? db
          .from("accounting_records")
          .select("id, doc_number, status")
          .eq("company_id", companyId)
          .eq("bank_account_id", accountId)
          .in(
            "doc_number",
            ledgerItems.map((i) => openItemRef(i.id)),
          )
      : Promise.resolve({ data: [] }),
  ]);

  const existingTxn = new Map(
    ((txnRes.data ?? []) as { txn_ref: string; status: string }[]).map((r) => [r.txn_ref, r.status]),
  );
  const existingRec = new Map(
    ((recRes.data ?? []) as { doc_number: string; status: string }[]).map((r) => [
      r.doc_number,
      r.status,
    ]),
  );

  const newTxns = bankItems
    .filter((i) => !existingTxn.has(openItemRef(i.id)))
    .map((i) => ({
      company_id: companyId,
      bank_account_id: accountId,
      txn_ref: openItemRef(i.id),
      amount: Number(i.amount),
      direction: i.direction,
      txn_date: i.as_at_date,
      value_date: i.as_at_date,
      narration: i.narration ?? i.doc_ref ?? "Open item brought forward",
      status: "unreconciled",
      meta: { ...(i.meta ?? {}), open_item_id: i.id, carried_forward: true },
    }));

  const newRecords = ledgerItems
    .filter((i) => !existingRec.has(openItemRef(i.id)))
    .map((i) => ({
      company_id: companyId,
      bank_account_id: accountId,
      doc_type: "Open item",
      doc_number: openItemRef(i.id),
      party_name: i.party_name,
      amount: Number(i.amount),
      side: i.direction,
      doc_date: i.as_at_date,
      status: "open",
      meta: {
        ...(i.meta ?? {}),
        open_item_id: i.id,
        carried_forward: true,
        Remarks: i.narration ?? i.doc_ref ?? "",
      },
    }));

  // Close open items whose mirror row has already been matched/reconciled so
  // they are not carried forward again.
  const settled = items.filter((i) => {
    const status =
      i.source === "bank" ? existingTxn.get(openItemRef(i.id)) : existingRec.get(openItemRef(i.id));
    return status === "reconciled";
  });

  await Promise.all([
    newTxns.length ? db.from("bank_transactions").insert(newTxns) : Promise.resolve(),
    newRecords.length ? db.from("accounting_records").insert(newRecords) : Promise.resolve(),
    settled.length
      ? db
          .from("open_items")
          .update({ status: "reconciled" })
          .in(
            "id",
            settled.map((i) => i.id),
          )
      : Promise.resolve(),
  ]);
}
