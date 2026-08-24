import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Relative base keeps the built bundle portable to any static host or subpath.
  base: './',
  resolve: {
    alias: {
      '@core': resolvePath('./src/core'),
      '@render': resolvePath('./src/render'),
      '@ui': resolvePath('./src/ui'),
      '@': resolvePath('./src'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolvePath('./index.html'),
        preview: resolvePath('./preview.html'),
      },
      output: {
        // Keep the renderer library in its own long-lived chunk so gameplay
        // iterations do not invalidate it for returning players.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  server: {
    port: 5173,
  },
});
