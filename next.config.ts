import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  serverExternalPackages: ['firebase-admin'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Firebase SDKのクライアントサイド互換性設定
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }
    
    // Firebase関連のバンドリング最適化
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          firebase: {
            test: /[\\/]node_modules[\\/](firebase|@firebase)[\\/]/,
            name: 'firebase',
            chunks: 'all',
            priority: 10,
          },
        },
      },
    };
    
    return config;
  },
  transpilePackages: ['firebase', '@firebase/app', '@firebase/firestore', '@firebase/database', '@firebase/storage', '@firebase/auth', '@firebase/functions'],
};

export default nextConfig;
