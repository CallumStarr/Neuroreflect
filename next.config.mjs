/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the built app is plain files that run entirely in the browser.
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false,
};
export default nextConfig;
