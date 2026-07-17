import { redirect } from "next/navigation";

// The product route moved to /dashboard. Keep /admin as a permanent redirect.
export default function AdminRedirect() {
  redirect("/dashboard");
}
