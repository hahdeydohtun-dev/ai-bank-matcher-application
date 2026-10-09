// Bank grid selection is always confined to eligible rows on the current page.
export function selectablePageIds(rows: { id: string; status: string }[]): string[] {
  return rows.filter((row) => row.status !== "reconciled" && row.status !== "rejected").map((row) => row.id);
}
export function scopedSelection(selected: string[], pageIds: string[]): string[] {
  const allowed = new Set(pageIds);
  return selected.filter((id) => allowed.has(id));
}