/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Link',
            value: '<https://fonts.reown.com/KHTeka-Medium.woff2>; rel=preload; as=font; type=font/woff2; crossorigin=anonymous',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
