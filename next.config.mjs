/** @type {import('next').NextConfig} */
const nextConfig = {
  // ビルド中のESLintエラーは無視（本番ビルドを止めない）
  eslint: {
    ignoreDuringBuilds: true,
  },

  // TypeScriptの型エラーで本番ビルドを失敗させる（安全寄り）
  typescript: {
    ignoreBuildErrors: false,
  },

  // サーバー側で外部化するパッケージ
  serverExternalPackages: ['firebase-admin'],

  // Webpackの微調整（クライアント側でNodeコアモジュールを使わない）
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
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

    // 注意: Next.jsでは optimization.splitChunks の上書きは非推奨/未サポート
    // デフォルトのチャンク戦略に任せる

    return config;
  },

  // Firebase関連のパッケージをtranspile
  transpilePackages: [
    'firebase',
    '@firebase/app',
    '@firebase/firestore',
    '@firebase/database',
    '@firebase/storage',
    '@firebase/auth',
    '@firebase/functions',
  ],
};

export default nextConfig;
