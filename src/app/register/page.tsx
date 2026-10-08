import { redirect } from "next/navigation";
import { getConfig } from "@/lib/config";
import { RegisterForm } from "@/components/auth/register-form";

/**
 * Registration is gated by the `ALLOW_REGISTRATION` env var, matching PHP's
 * GET /register check (it flashes an error and redirects to /login). Reading
 * the flag requires the server, hence this wrapper around the client form.
 *
 * `force-dynamic` matters: without it Next prerenders this route at build time,
 * which would bake the build machine's env value into the output and ignore the
 * flag on the running server.
 */
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  if (!getConfig().allowRegistration) redirect("/login");
  return <RegisterForm />;
}
