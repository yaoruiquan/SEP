/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  // Proxy API calls to the NestJS backend so the browser talks same-origin
  // (keeps the refresh-token httpOnly cookie first-party, avoids CORS in dev).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
