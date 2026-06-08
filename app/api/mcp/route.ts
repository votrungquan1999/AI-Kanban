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
 * Validates a `?token=` URL query parameter against the `MCP_URL_TOKEN`
 * credential. This is the additive auth path for a claude.ai cloud routine
 * connector, which can only carry a secret in the URL and cannot send a custom
 * `Authorization` header. Short-circuits to `false` when either the configured
 * token or the supplied token is empty, so an unset `MCP_URL_TOKEN` can never be
 * matched by an absent/empty `?token=` (which {@link safeEqual} would otherwise
 * treat as an empty-vs-empty match).
 * @param request - The incoming request.
 * @returns `true` only when a non-empty `?token=` matches a non-empty `MCP_URL_TOKEN`.
 */
function isTokenAuthorized(request: Request): boolean {
  const configured = process.env.MCP_URL_TOKEN ?? "";
  if (configured === "") return false;

  const supplied = new URL(request.url).searchParams.get("token") ?? "";
  if (supplied === "") return false;

  return safeEqual(supplied, configured);
}

/**
 * Handles MCP Streamable-HTTP `POST` requests. Gates on auth before delegating
 * to the dispatch adapter — a request is admitted when HTTP Basic auth passes
 * OR a valid `?token=` is present — so an unauthenticated request is rejected
 * with 401 and no tool ever runs.
 * @param request - The incoming MCP request.
 * @returns A 401 challenge when unauthorized, otherwise the adapter's response.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request) && !isTokenAuthorized(request)) {
    return new Response(null, {
      status: 401,
      headers: { "WWW-Authenticate": "Basic" },
    });
  }

  return handler(request);
}
