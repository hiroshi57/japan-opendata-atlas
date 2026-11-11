import { defineConfig } from 'vite';

// 静的ホスティング（GitHub Pages / Cloudflare Pages 等）でも動くよう相対パスでビルド
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1200 },
});
