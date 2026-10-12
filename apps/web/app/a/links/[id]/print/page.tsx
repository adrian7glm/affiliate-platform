import { redirect } from 'next/navigation';

/** The A5 poster now lives in the QR kit; old bookmarks land there. */
export default async function PosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/a/kit?link=${encodeURIComponent(id)}&format=poster-a5`);
}
