import { processEvent } from "./process-event";
import { reconcileAll, reconcileOne } from "./reconcile";
import { materializeFlowFn } from "./materialize";
import { syncConnection, reprocessConnectionFn, flowDataChanged, recomputeStaleFlows, materializeStale } from "./sync";

export const functions = [
  processEvent,
  reconcileAll,
  reconcileOne,
  materializeFlowFn,
  syncConnection,
  reprocessConnectionFn,
  flowDataChanged,
  recomputeStaleFlows,
  materializeStale,
];
