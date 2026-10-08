/** @type {import('next').NextConfig} */
const isHttps = (process.env.APP_URL ?? "").trim().toLowerCase().startsWith("https://");

/**
 * Baseline security headers.
 *
 * `frame-ancestors 'none'` / X-Frame-Options stop the admin console being framed
 * for clickjacking. This does **not** affect the embeddable widget: `widget.js` is
 * a script that creates its own DOM inside the customer's page rather than an
 * iframe of this origin, and the public API routes answer JSON.
 *
 * The CSP covers the directives that do not need a per-request nonce (object,
 * base-uri, framing, form targets). A full `script-src` policy would need nonce
 * plumbing through every server component and is deliberately left for a
 * follow-up — see docs/security-audit.md.
 *
 * `Cross-Origin-Resource-Policy` is deliberately NOT set globally: `public/widget.js`
 * is loaded by customer sites on other origins, so `same-origin` on it would break
 * every embed. The public API routes are JSON and are not embeddable resources.
 * (Trivy/ZAP flag 90004 as a Low finding here; it is accepted, not overlooked.)
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-Frame-Options", value: "DENY" },
  // `form-action` does not fall back to default-src, so it must be stated
  // explicitly (ZAP 10055). Safe here: every form in the admin console posts to
  // this origin via fetch, and nothing submits cross-origin.
  { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
];

// Only meaningful (and only safe) for a deployment that is actually served over
// TLS; a browser ignores HSTS on plain HTTP anyway.
if (isHttps) {
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  });
}

const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework version.
  poweredByHeader: false,
  // Hide the floating "Next.js" dev-tools badge (bottom-left) so it does not
  // overlap the sidebar's sign-out control during development.
  devIndicators: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
