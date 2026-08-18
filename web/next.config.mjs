/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3001';

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        pathname: '/**',
      },
    ],
  },
  // Proxy API calls to the NestJS backend so the browser talks same-origin
  // (keeps the refresh-token httpOnly cookie first-party, avoids CORS in dev).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
  // 「权限管理」页已删除（授权审批并入「雇佣管理」），
  // 老标签/书签访问 /permissions 时别再 404，统一跳回工作台。
  async redirects() {
    return [
      {
        source: '/permissions',
        destination: '/dashboard',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
