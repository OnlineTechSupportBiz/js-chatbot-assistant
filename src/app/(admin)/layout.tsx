import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { isAdmin } from "@/lib/auth/authorization";
import { Sidebar } from "@/components/sidebar";
import { DatabaseUnavailable } from "@/components/database-unavailable";
import { TimezoneProvider } from "@/components/timezone";
import { isDatabaseUnavailable } from "@/lib/db-errors";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await getServerSession();
  } catch (err) {
    // The session lives in Postgres, so an unreachable database fails here
    // first, before any page runs. Render the outage screen rather than letting
    // the driver error escape to the error boundary.
    if (isDatabaseUnavailable(err)) {
      return <DatabaseUnavailable />;
    }
    throw err;
  }

  if (!session.isAuthenticated()) redirect("/login");

  const user = session.user;
  // The admin area requires the admin role and a confirmed email address. The
  // verification gate is enforced at sign-in too; it is repeated here so a session
  // that predates that check (or any future flow that issues one) cannot reach the
  // admin pages without a verified address.
  if (!user || !isAdmin(user) || !user.email_verified_at) redirect("/login");

  // Every timestamp in the admin tree renders in this zone instead of the
  // browser's. The session carries it because PHP stores it there too, and the
  // settings save refreshes it so a change takes effect immediately.
  //
  // Sidebar renders the topbar + drawer as siblings of <main>, so the grid
  // areas below are declared in the order the DOM actually has them.
  return (
    <div className="admin-shell">
      {/* PHP's layout renders $brandName (the user's Settings → Branding value) here. */}
      <Sidebar brandName={user.brand_name} />
      <TimezoneProvider timezone={session.user?.timezone ?? "UTC"}>
        <main className="admin-main" id="main-content">
          {children}
        </main>
      </TimezoneProvider>
    </div>
  );
}
