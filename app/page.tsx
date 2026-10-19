'use client';

import dynamic from 'next/dynamic';

// The whole app is client-only: it lives in IndexedDB and never renders user
// data on a server. Rendering it client-side also rules out hydration mismatches.
const Shell = dynamic(() => import('@/components/Shell'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-ink-950 font-serif text-lg text-paper-500">Opening your journal</div>
  ),
});

export default function Page() {
  return <Shell />;
}
