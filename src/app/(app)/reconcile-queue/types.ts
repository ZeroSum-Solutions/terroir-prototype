import type {
  ReconcileQueueRow,
  ReconcileQueueSummary,
} from "@/lib/reconcile-queue";
import type { ReconcileAction } from "@/lib/reconcile-ledger";

export type QueueBin = {
  id: string;
  code: string;
  zone: string | null;
};

export type LatestBatch = {
  id: string;
  action_count: number;
  created_at: string;
};

export type QueueResponse = {
  issues: ReconcileQueueRow[];
  summary: ReconcileQueueSummary;
  latest_batch: LatestBatch | null;
  bins: QueueBin[];
};

export type AcceptAction = ReconcileAction;
