/**
 * The operator explicitly configures JARVIS_PUBLIC_ORIGIN for a public/proxied
 * preview. Never learn an origin allowlist from an attacker-controlled header.
 * In development ONLY, localhost matching is permitted for the local dev app.
 */
export function publicOrigin(): string | null {
  const raw = process.env.JARVIS_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) return null;
    // Public deployments should use HTTPS; localhost is the sole HTTP exception.
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function mutationOriginError(headers: Pick<Headers, 'get'>): string | null {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return 'Cross-origin state changes are rejected.';
  const submitted = headers.get('origin');
  const configured = publicOrigin();
  // Production behind a proxy MUST have a trusted configured public origin.
  let allowed = configured;
  if (!allowed && process.env.NODE_ENV !== 'production') {
    const host = headers.get('host')?.toLowerCase() ?? '';
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
      allowed = `http://${host}`;
    }
  }
  if (!allowed) return 'Public application origin is not configured.';
  if (!submitted) {
    // Browser state-changing requests normally send Origin; refuse a request
    // that explicitly identifies a non-same-origin browser context.
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return 'Origin header required for this browser request.';
    }
    // Non-browser integrations must still possess a valid authenticated
    // session; without credentials this header exception grants nothing.
    return null;
  }
  try {
    if (new URL(submitted).origin !== allowed) {
      return 'Cross-origin state changes are rejected.';
    }
  } catch {
    return 'Malformed Origin header.';
  }
  return null;
}
