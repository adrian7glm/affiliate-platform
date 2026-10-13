import type { Metadata } from 'next';
import { getServerT, serverLang } from '@/lib/i18n-server';
import { ProductsScreen } from './ProductsScreen';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT(await serverLang());
  return { title: t('catalog.products.title') };
}

export default function ProductsPage() {
  return <ProductsScreen />;
}
