/** @type {import('next').NextConfig} */
const nextConfig = {
  // 開発時に左下へ出る Next.js のマークを消す（画面の表示と重なるため）
  devIndicators: false,
  // firebase-admin はサーバー専用。バンドルせず Node の require に任せる
  serverExternalPackages: ['firebase-admin'],
  // 画像・動画はブラウザから直接 Firebase Storage へ送るので、サーバーへの送信は小さいままでよい
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
