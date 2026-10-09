import { describe, expect, it } from "vitest";
import { scopedSelection, selectablePageIds } from "./tableSelection";

describe("bank table selection scope", () => {
  it("selects only eligible transactions on the current page", () => {
    expect(selectablePageIds([{ id: "page-open", status: "unreconciled" }, { id: "settled", status: "reconciled" }, { id: "rejected", status: "rejected" }])).toEqual(["page-open"]);
  });
  it("drops selections outside the current filtered page", () => {
    expect(scopedSelection(["current", "other-page", "filtered-out"], ["current", "new"])).toEqual(["current"]);
  });
});