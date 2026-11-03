"use client";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui";
import { KIND_LABELS, monthLabel } from "@/lib/finance";
import { clsx } from "@/lib/format";
import type { LedgerRow, TxnKind } from "@/lib/types";

export function KindBadge({ kind }: { kind: TxnKind }) {
  const tone = kind === "expense" ? "red" : kind === "opening_balance" ? "grey" : "green";
  return <Badge tone={tone}>{KIND_LABELS[kind].hi} · {KIND_LABELS[kind].en}</Badge>;
}

export function TxnDetails({ r, onReceipt }: { r: LedgerRow; onReceipt?: (path: string) => void }) {
  const main = r.kind === "contribution" ? r.member_name ?? "—" : r.title ?? KIND_LABELS[r.kind].en;
  return (
    <div className="min-w-0">
      <p className={clsx("font-medium text-forest", r.is_reversed && "line-through opacity-60")}>
        {main}
        {r.kind === "contribution" && r.period_month && <span className="font-normal text-muted"> · {monthLabel(r.period_month.slice(0, 7))}</span>}
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        {r.category && <Badge tone="grey">{r.category}</Badge>}
        {r.is_reversed && <Badge tone="red">उलटा गया · Reversed</Badge>}
        {r.is_reversal && <Badge tone="gold">सुधार प्रविष्टि · Reversal</Badge>}
        {r.source !== "native" && <Badge tone="grey">{r.source === "salesforce_import" ? "Salesforce" : "Excel"} import</Badge>}
      </div>
      {(r.description || r.remarks || r.reversal_reason) && (
        <p className="mt-1 text-xs text-muted">{[r.description, r.remarks !== r.reversal_reason ? r.remarks : null, r.reversal_reason && `Reason: ${r.reversal_reason}`].filter(Boolean).join(" · ")}</p>
      )}
      {r.paid_by && <p className="text-xs text-muted">Paid by: {r.paid_by}</p>}
      {r.receipt_path && onReceipt && (
        <button className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-leaf-700 hover:underline" onClick={() => onReceipt(r.receipt_path!)}>
          <Paperclip className="h-3 w-3" /> रसीद · Receipt
        </button>
      )}
    </div>
  );
}

