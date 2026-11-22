import { ButtonLink } from "@/components/ui";
export default function NotFound() {
  return (
    <main className="standalone">
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>That page is out of scope.</h1>
      <p className="text-muted">
        The project or case may not exist in this preview.
      </p>
      <ButtonLink href="/dashboard">Back to overview</ButtonLink>
    </main>
  );
}
