/**
 * SSRF hostname validation for GHE and Atlassian connections.
 * validateHostname: blocks localhost, loopback, link-local, private IP ranges.
 * validateAtlassianHostname: additionally enforces *.atlassian.net + a DNS resolution check.
 */

import dns from "node:dns/promises";

/** Hostnames and IP literals unconditionally blocked (SSRF prevention). */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254",          // AWS/Azure/GCP instance metadata
  "metadata.google.internal", // GCP metadata
]);

/**
 * Private IPv4 CIDR ranges expressed as [prefix_a, prefix_b_min, prefix_b_max].
 * Checked against dotted-decimal IP literals only.
 */
function isPrivateIpv4(a: number, b: number): boolean {
  return (
    a === 10 ||                         // 10.0.0.0/8
    a === 127 ||                        // 127.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||         // 192.168.0.0/16
    (a === 169 && b === 254)            // 169.254.0.0/16 (link-local)
  );
}

/**
 * Validate that a hostname is not a private/loopback/link-local address.
 * Only checks the literal hostname string — does NOT perform DNS resolution.
 * Throws if the hostname is blocked.
 */
export function validateHostname(hostname: string): void {
  const lower = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(lower)) {
    throw new Error(`Hostname "${hostname}" is not allowed`);
  }

  const ipv4Parts = lower.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = ipv4Parts.map(Number) as [number, number, number, number];
    if (isPrivateIpv4(a, b)) {
      throw new Error(`Hostname "${hostname}" is a private/reserved IP address and is not allowed`);
    }
  }
}

/**
 * Check that a resolved IP address is not in a private/reserved range.
 */
function assertPublicIp(ip: string, hostname: string): void {
  const lower = ip.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower)) {
    throw new Error(`Hostname "${hostname}" resolves to a blocked address`);
  }
  const ipv4Parts = lower.split(".");
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = ipv4Parts.map(Number) as [number, number, number, number];
    if (isPrivateIpv4(a, b)) {
      throw new Error(`Hostname "${hostname}" resolves to a private IP address`);
    }
  }
}

/**
 * Validate an Atlassian hostname: must end in .atlassian.net, pass the static
 * SSRF check, and resolve to a public IP (fail-closed on DNS rebinding / unresolvable hosts).
 * This hardening is scoped to the Atlassian connection path only.
 */
export async function validateAtlassianHostname(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase();
  if (!lower.endsWith(".atlassian.net")) {
    throw new Error(`Hostname "${hostname}" is not a valid Atlassian Cloud hostname (must end with .atlassian.net)`);
  }
  validateHostname(lower);

  let addresses: string[] = [];
  try {
    const v4 = await dns.resolve4(lower).catch(() => [] as string[]);
    const v6 = await dns.resolve6(lower).catch(() => [] as string[]);
    addresses = [...v4, ...v6];
  } catch {
    throw new Error(`Hostname "${hostname}" could not be resolved. Only resolvable public hostnames are allowed.`);
  }
  if (addresses.length === 0) {
    throw new Error(`Hostname "${hostname}" could not be resolved. Only resolvable public hostnames are allowed.`);
  }
  for (const ip of addresses) assertPublicIp(ip, hostname);
}
