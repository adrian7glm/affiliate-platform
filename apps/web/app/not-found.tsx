import { ButtonLink } from '@/components/Button';

export default function NotFound() {
  return (
    <main className="page-x mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 py-10">
      <p className="text-5xl font-extrabold text-brand">404</p>
      <h1 className="text-2xl font-bold">Pagina nu există</h1>
      <p className="text-muted" lang="en">
        This page does not exist.
      </p>
      <ButtonLink href="/" size="lg">
        Mergi la prima pagină
      </ButtonLink>
    </main>
  );
}
