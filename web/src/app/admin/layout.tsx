import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  // Nothing here belongs in search results
  robots: { index: false, follow: false },
};

// Wraps every page under /admin: the admin check and the admin navigation
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
