// Handler functions may be re-exported from another module; the route segment
// config constants (`runtime`, `dynamic`) may NOT — Next.js parses them
// statically per file and errors ("can't recognize the exported `dynamic`
// field") if they arrive via a re-export. Confirmed against the real
// mcp-handler + Next dev server (Task 7's brief-mandated check), not just the
// mocked test.
export { GET, OPTIONS } from "../../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
