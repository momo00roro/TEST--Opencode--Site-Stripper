import { ALLOWED_PORTS, ALLOWED_PROTOCOLS } from "../config/limits";
import { ApiError, badRequest, forbidden } from "../http/errors";
import type { FetchLike } from "./doh";
import { resolveHostViaDoh } from "./doh";
import { isBlockedHostname } from "./hostnames";
import { ipLiteralKind, isBlockedIpLiteral } from "./ip";

const MAX_URL_LENGTH = 2048;

export interface NormalizedUrl {
  raw: string;
  url: URL;
  origin: string;
  hostname: string;
}

export function parseHttpUrl(raw: unknown): NormalizedUrl {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw badRequest("MISSING_URL", "A non-empty `url` string is required.");
  }

  const trimmed = raw.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    throw badRequest("INVALID_URL", `URL exceeds the ${MAX_URL_LENGTH} character limit.`);
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw badRequest("INVALID_URL", "URL could not be parsed. Provide an absolute HTTP(S) URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw badRequest(
      "UNSUPPORTED_PROTOCOL",
      `Protocol "${url.protocol}" is not allowed. Use http: or https:.`,
      { protocol: url.protocol },
    );
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw badRequest("CREDENTIALS_NOT_ALLOWED", "URLs containing credentials are not allowed.");
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw badRequest("PORT_NOT_ALLOWED", `Port "${url.port}" is not allowed. Use 80 or 443.`, {
      port: url.port,
    });
  }

  if (url.hostname.length === 0) {
    throw badRequest("INVALID_URL", "URL is missing a hostname.");
  }

  url.hash = "";
  const normalized: URL = url;

  return {
    raw: trimmed,
    url: normalized,
    origin: normalized.origin,
    hostname: normalized.hostname,
  };
}

export async function assertPublicTarget(
  target: NormalizedUrl,
  fetchImpl: FetchLike,
): Promise<string[]> {
  const hostname = target.hostname.replace(/\.$/, "");

  if (ipLiteralKind(hostname)) {
    if (isBlockedIpLiteral(hostname)) {
      throw forbidden("PRIVATE_TARGET", "Target resolves to a private, loopback, or reserved address.", {
        hostname,
      });
    }
    return [hostname];
  }

  if (isBlockedHostname(hostname)) {
    throw forbidden("PRIVATE_TARGET", "Target hostname is not a public, routable host.", { hostname });
  }

  const ips = await resolveHostViaDoh(hostname, fetchImpl);

  if (ips.length === 0) {
    throw new ApiError(
      "HOST_RESOLUTION_FAILED",
      400,
      "Target hostname could not be resolved to a public address.",
      { hostname },
    );
  }

  for (const ip of ips) {
    if (isBlockedIpLiteral(ip)) {
      throw forbidden("PRIVATE_TARGET", "Target resolves to a private, loopback, or reserved address.", {
        hostname,
        address: ip,
      });
    }
  }

  return ips;
}
