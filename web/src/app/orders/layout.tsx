import { AccountShell } from "@/components/account-shell";

// The account side menu around every page in this folder (see AccountShell)
export default function Layout({ children }: LayoutProps<"/orders">) {
  return <AccountShell>{children}</AccountShell>;
}
