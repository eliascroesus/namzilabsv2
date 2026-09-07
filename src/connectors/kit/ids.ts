import { hashId } from "@/lib/ids";

/** `source:connectionId:part:part` — the namespace every connector's dedup key carries. */
export function eventId(source: string, connectionId: string, ...parts: Array<string | number>): string {
  return `${source}:${connectionId}:${parts.join(":")}`;
}

/** The provider's own id when it has one; a stable hash of the payload when it does not. */
export function naturalOrHash(source: string, connectionId: string, natural: string | null | undefined, payload: unknown): string {
  return natural ? eventId(source, connectionId, natural) : hashId(`${source}:${connectionId}`, payload);
}
