/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/ui"],
  async rewrites() {
    // eslint-disable-next-line no-undef
    const backend = process.env.NEXT_PUBLIC_API_URL;
    return [
      // Same-origin proxy for better-auth → login sets a first-party cookie.
      { source: "/api/auth/:path*", destination: `${backend}/api/auth/:path*` },
      // Same-origin proxy for all other backend calls (services hit /be/*) so the
      // first-party session cookie is sent — *.vercel.app ↔ *.onrender.com are
      // cross-site and browsers block third-party cookies.
      { source: "/be/:path*", destination: `${backend}/:path*` },
    ];
  },
};

export default nextConfig;
