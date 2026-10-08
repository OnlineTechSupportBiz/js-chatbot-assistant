import { getConfig } from "@/lib/config";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Server wrapper so the client form can be told whether new sign-ups are open
 * (`ALLOW_REGISTRATION`), which decides if the "Create one" link is shown.
 *
 * `force-dynamic` matters: without it Next prerenders this route at build time,
 * which would bake the build machine's env value into the output and ignore the
 * flag on the running server.
 */
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm registrationEnabled={getConfig().allowRegistration} />;
}
