import { defineConfig } from 'vitest/config';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  plugins: [
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
  ],
  define: {
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    silent: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
    server: {
      deps: {
        inline: ['@zkp2p/sdk'],
      },
    },
  },
  resolve: {
    conditions: ['development'],
    alias: {
      '@config': path.resolve(__dirname, 'src/config'),
      '@assets': path.resolve(__dirname, 'src/assets'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@entries': path.resolve(__dirname, 'src/entries'),
    },
  },
});
