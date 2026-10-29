import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app's own version, for the tester usage summary.
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // Static export: the built app is plain files that run entirely in the browser.
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false,
};
export default nextConfig;
