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
 * Validates a base64-encoded `user:pass` credential (the value that follows
 * `Basic ` in an `Authorization` header) against the shared `MCP_BASIC_USER` /
 * `MCP_BASIC_PASS` pair. Shared by both auth paths — the `Authorization` header
 * and the `?token=` URL param carry the same base64 string. Returns `false`
 * (never throws) on empty config, empty input, a malformed credential, or a
 * mismatch, so the route answers 401 instead of 500. Short-circuits when the
 * configured pair is empty (unset env) or the supplied value is empty, so an
 * unset credential can never be matched by an empty/absent token (which
 * {@link safeEqual} would otherwise treat as an empty-vs-empty match).
 * @param encoded - The base64-encoded `user:pass` string.
 * @returns `true` only when a non-empty credential matches a configured pair.
 */
function validateBasicCredential(encoded: string): boolean {
  const envUser = process.env.MCP_BASIC_USER ?? "";
  const envPass = process.env.MCP_BASIC_PASS ?? "";
  if (envUser === "" && envPass === "") return false;
  if (encoded === "") return false;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;

  const user = decoded.slice(0, separator);
  const pass = decoded.slice(separator + 1);

  return safeEqual(user, envUser) && safeEqual(pass, envPass);
}

/**
 * Validates an HTTP Basic `Authorization` header against the shared credentials.
 * @param request - The incoming request.
 * @returns `true` only when a valid `Basic <base64 user:pass>` header matches.
 */
function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  return validateBasicCredential(header.slice("Basic ".length));
}

/**
 * Validates a `?token=` URL query parameter against the shared credentials.
 * This is the additive auth path for a claude.ai cloud routine connector, which
 * can only carry a secret in the URL and cannot send a custom `Authorization`
 * header. The token is the SAME `base64(user:pass)` used after `Basic ` in the
 * header — no separate secret — so it is validated by the same
 * {@link validateBasicCredential}.
 * @param request - The incoming request.
 * @returns `true` only when a non-empty `?token=` matches the configured pair.
 */
function isTokenAuthorized(request: Request): boolean {
  const supplied = new URL(request.url).searchParams.get("token") ?? "";
  return validateBasicCredential(supplied);
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
