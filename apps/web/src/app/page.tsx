import { redirect } from "next/navigation";
// The proxy sends visitors without a session cookie to /sign-in; the
// workspace gate verifies the actual session before rendering anything.
export default function Home() {
  redirect("/dashboard");
}
