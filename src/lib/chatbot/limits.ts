/**
 * Combining the operator's abuse ceilings with a tenant's own, stricter limits.
 *
 * Two levels of protection exist on the public chat endpoint:
 *
 *  1. **Server ceilings** (`PUBLIC_CHAT_RATE_MAX` per IP, `PUBLIC_CHAT_TOKEN_RATE_MAX`
 *     per widget token, `PUBLIC_CHAT_RATE_WINDOW` seconds). These key on values the
 *     caller cannot choose — the network address and the chatbot's own token — so
 *     they are the ones that actually stop a script. They protect the instance and
 *     the tenant's API bill, and no tenant can raise them.
 *
 *  2. **Tenant limits** (`chatbots.rate_limit_per_ip` and `rate_limit_per_token`).
 *     A tenant can tighten either one for their own chatbot. The effective limit is
 *     the lower of the two, which is the whole point: tightening is a tenant
 *     decision, widening is not.
 *
 * The per-chatbot `rate_limit_per_session` is a separate, softer thing: it counts
 * messages per visitor *session*, and the session id comes from the browser, so a
 * script that rotates it is unaffected. It shapes polite usage; it is not a
 * security boundary.
 */

export interface OperatorRateLimits {
  maxPerIp: number;
  maxPerToken: number;
  windowSeconds: number;
}

/** The two tenant-tunable ceilings on a chatbot row (nullable = no opinion). */
export interface TenantRateLimits {
  rate_limit_per_ip: number | null;
  rate_limit_per_token: number | null;
}

export interface EffectiveRateLimits {
  /** Requests per window allowed from one IP bucket. */
  ipMax: number;
  /** Requests per window allowed for the chatbot as a whole. */
  tokenMax: number;
  windowSeconds: number;
}

/** A configured limit only counts when it is a positive integer. */
function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolve the limits actually enforced for one request.
 *
 * `sharedBucket` is true when the caller's address could not be trusted (no proxy
 * hops configured and no usable socket address), in which case the server ceiling
 * is raised by 10× so that one shared bucket cannot lock every visitor out. A
 * tenant's own per-IP limit is applied unchanged on top of that.
 */
export function effectiveRateLimits(
  operator: OperatorRateLimits,
  chatbot: TenantRateLimits,
  sharedBucket: boolean,
): EffectiveRateLimits {
  const ipCeiling = sharedBucket ? operator.maxPerIp * 10 : operator.maxPerIp;
  const tenantIp = positiveOrNull(chatbot.rate_limit_per_ip);
  const tenantToken = positiveOrNull(chatbot.rate_limit_per_token);

  return {
    ipMax: tenantIp === null ? ipCeiling : Math.min(ipCeiling, tenantIp),
    tokenMax: tenantToken === null ? operator.maxPerToken : Math.min(operator.maxPerToken, tenantToken),
    windowSeconds: operator.windowSeconds,
  };
}
