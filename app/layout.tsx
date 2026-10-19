import type { Metadata } from 'next';
// Fonts are bundled with the app, so nothing is fetched from a third party.
import '@fontsource-variable/literata/opsz.css';
import '@fontsource-variable/literata/opsz-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'NeuroReflect',
  description: 'A local-first reflective journal with live psychological telemetry.',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="overflow-hidden">{children}</body>
    </html>
  );
}
