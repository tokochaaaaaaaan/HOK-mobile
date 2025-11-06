const nextConfig = {
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

    // 注意: Next.jsでは optimization.splitChunks の上書きは非推奨/未サポートです。
    // ここでの上書きは削除し、デフォルトのチャンク戦略に委ねます。
    // （devのRSC/webpackランタイムで "reading 'call'" の不整合を誘発するため）

    return config;
  },
  transpilePackages: ['firebase', '@firebase/app', '@firebase/firestore', '@firebase/database', '@firebase/storage', '@firebase/auth', '@firebase/functions'],
};

module.exports = nextConfig;