import type { Metadata } from 'next';
import { ProductsScreen } from './ProductsScreen';

export const metadata: Metadata = { title: 'Excursii și plecări' };

export default function ProductsPage() {
  return <ProductsScreen />;
}
