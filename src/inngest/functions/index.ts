import { processEvent } from "./process-event";
import { reconcileAll, reconcileOne } from "./reconcile";
import { materializeFlowFn } from "./materialize";
import { runFlowTest } from "./test-run";
import { syncConnection, reprocessConnectionFn, flowDataChanged, recomputeStaleFlows, materializeStale, pruneStorage } from "./sync";

export const functions = [
  processEvent,
  reconcileAll,
  reconcileOne,
  materializeFlowFn,
  runFlowTest,
  syncConnection,
  reprocessConnectionFn,
  flowDataChanged,
  recomputeStaleFlows,
  materializeStale,
  pruneStorage,
];
