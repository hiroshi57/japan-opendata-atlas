import { defineConfig } from 'vite';

// 単一 HTML 版: すべてのアセットを data: URL でインライン化し、動的 import も 1 チャンクにまとめる。
// ビルド後に scripts/inline-single.mjs が JS/CSS を HTML に埋め込む。
export default defineConfig({
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist-single',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
