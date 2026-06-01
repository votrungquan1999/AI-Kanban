import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { registerDispatchTools } from "@/mcp/dispatch-server";

export const runtime = "nodejs";

const handler = createMcpHandler(
  (server) => registerDispatchTools(server),
  {},
  { basePath: "/api", disableSse: true },
);

/**
 * Constant-time string equality. Length-guards first because
 * {@link timingSafeEqual} throws a `RangeError` on unequal-length buffers,
 * which would surface as a 500 instead of a clean 401.
 * @param a - First value.
 * @param b - Second value.
 * @returns `true` when the two byte sequences are identical.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validates an HTTP Basic `Authorization` header against the shared
 * `MCP_BASIC_USER` / `MCP_BASIC_PASS` credentials. Returns `false` (never
 * throws) on a missing, malformed, or mismatched credential so the route can
 * answer 401 instead of 500.
 * @param request - The incoming request.
 * @returns `true` only when valid Basic credentials match the configured pair.
 */
function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString(
    "utf8",
  );
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  return (
    safeEqual(user, process.env.MCP_BASIC_USER ?? "") &&
    safeEqual(pass, process.env.MCP_BASIC_PASS ?? "")
  );
}

/**
 * Handles MCP Streamable-HTTP `POST` requests. Gates on HTTP Basic auth before
 * delegating to the dispatch adapter, so an unauthenticated request is rejected
 * with 401 and no tool ever runs.
 * @param request - The incoming MCP request.
 * @returns A 401 challenge when unauthorized, otherwise the adapter's response.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response(null, {
      status: 401,
      headers: { "WWW-Authenticate": "Basic" },
    });
  }

  return handler(request);
}
