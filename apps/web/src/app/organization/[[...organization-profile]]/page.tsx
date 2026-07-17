import { AppNav } from "@/components/app-nav";
import { OrganizationManager } from "./organization-manager";

export const dynamic = "force-dynamic";

export default function OrganizationPage() {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return (
    <div className="app-shell">
      <AppNav />
      <main className="app-main organization-main">
        <section className="organization-heading">
          <span className="metric-label">Workspace</span>
          <h1>Organization and members</h1>
          <p>Manage the active organization, invitations, and member roles.</p>
        </section>
        <div className="clerk-organization-frame">
          {clerkConfigured ? (
            <OrganizationManager />
          ) : (
            <p className="notice standalone">Clerk Organizations is not configured.</p>
          )}
        </div>
      </main>
    </div>
  );
}
