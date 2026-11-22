import { Suspense } from "react";
import { SignIn } from "@/components/sign-in";
import { FullscreenStatus } from "@/components/auth-gate";
export const metadata = { title: "Sign in" };
export default function SignInPage() {
  return (
    <Suspense fallback={<FullscreenStatus label="Loading sign-in…" />}>
      <SignIn />
    </Suspense>
  );
}
