import { ButtonLink } from "@/components/ui";
import { Logo } from "@/components/brand";
export default function NotFound() {
  return (
    <main className="standalone">
      <Logo />
      <p className="eyebrow-text mt-6">404</p>
      <h1>Page not found</h1>
      <p className="text-muted">
        This page doesn’t exist, or the project or dispute ID is not valid.
      </p>
      <ButtonLink href="/dashboard">Back to overview</ButtonLink>
    </main>
  );
}
