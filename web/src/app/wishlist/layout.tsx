import { AccountShell } from "@/components/account-shell";

// The account side menu around every page in this folder (see AccountShell)
export default function Layout({ children }: LayoutProps<"/wishlist">) {
  return <AccountShell>{children}</AccountShell>;
}
