"use client";

import { useState } from "react";
import { ConditionEditor } from "./controls/ConditionEditor";
import type { DataGroup } from "./controls/types";
import type { FilterConfig } from "@/lib/flow/types";

/**
 * The condition builder, for the kit — and it is LIVE rather than a picture.
 *
 * `ConditionEditor` is controlled: it takes a `FilterConfig` and an `onChange`,
 * and /design is a server component, which cannot hand a client component a
 * function. Same reason `empty-canvas-preview` and `panel-preview` exist. So
 * the state lives here and the REAL component is rendered unmodified — there is
 * no copy of its markup anywhere, so the kit page cannot drift from the builder.
 *
 * IT HOLDS STATE RATHER THAN STUBBING THE CALLBACK, which the other previews do
 * not need to. Duplicate and Remove are only observable by USING them: a stubbed
 * `onChange` would render three conditions that never change, and the one thing
 * worth looking at here is what happens after a press.
 *
 * The sample is the real case that produced the Duplicate button — three
 * alternatives on one field, differing only in the last box.
 */
const SAMPLE_GROUPS: DataGroup[] = [
  {
    stepId: "s1",
    stepNo: 1,
    source: "gsheets",
    title: "Google Sheets",
    fields: [
      { path: "properties.willing_to_invest", label: "Willing to invest", type: "string", sample: "$2,500 - $5,000" },
      { path: "properties.booked", label: "Booked", type: "string", sample: "Yes" },
      { path: "properties.who_claimed", label: "Who claimed", type: "string", sample: "8208777951" },
    ],
  },
];

const SAMPLE: FilterConfig = {
  combinator: "or",
  rules: [
    { field: "properties.willing_to_invest", op: "starts_with", value: "$1,000", valueKind: "fixed" },
    { field: "properties.willing_to_invest", op: "starts_with", value: "$2,500", valueKind: "fixed" },
  ],
};

export function ConditionEditorPreview() {
  const [cfg, setCfg] = useState<FilterConfig>(SAMPLE);
  return <ConditionEditor value={cfg} onChange={setCfg} groups={SAMPLE_GROUPS} />;
}
