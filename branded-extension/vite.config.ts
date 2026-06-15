import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import fs from 'fs';
import path from 'path';
import type { RollupWarning } from 'rollup';

// Icons emitted into the build root. rebrand.mjs keeps src/assets in sync with
// the brand.config.json iconDir.
const ICON_FILES = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];

// Reads src/manifest.json, stamps the version from package.json (single source
// of truth for the version), and emits it as the build's manifest.json.
const manifestPlugin = () => ({
  name: 'extension-manifest',
  apply: 'build' as const,
  generateBundle() {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, 'src/manifest.json'), 'utf-8'),
    );
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

    const outputManifest = { ...manifest, version: pkg.version };

    this.emitFile({
      type: 'asset',
      fileName: 'manifest.json',
      source: JSON.stringify(outputManifest, null, 2),
    });
  },
});

const copyStaticAssets = (mode: string) => {
  let outputDir = path.resolve(__dirname, 'build');

  const copyFile = (src: string, dest: string) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  };

  return {
    name: 'extension-static-assets',
    apply: 'build' as const,
    configResolved(config: { root: string; build: { outDir: string } }) {
      outputDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const iconDir = mode === 'development' ? 'src/assets/dev' : 'src/assets/img';
      ICON_FILES.forEach((file) => {
        copyFile(path.resolve(__dirname, iconDir, file), path.resolve(outputDir, file));
      });
    },
  };
};

export default defineConfig(({ command, mode }) => {
  const emptyShim = path.resolve(__dirname, 'src/shims/empty.ts');
  const workerThreadsShim = path.resolve(__dirname, 'src/shims/worker-threads.ts');
  const cryptoBrowserShim = path.resolve(__dirname, 'crypto-browser.js');
  const re2Shim = path.resolve(__dirname, 'src/shims/re2.cjs');
  const isDevBuild = command === 'build' && mode === 'development';

  const shouldIgnoreWarning = (warning: RollupWarning) => {
    if (warning.code === 'INVALID_ANNOTATION') return true;
    if (warning.code === 'CHUNK_SIZE_LIMIT') return true;
    if (warning.code === 'EVAL' && warning.id?.includes('vm-browserify')) return true;
    if (warning.message?.includes('Use of eval') && warning.id?.includes('vm-browserify')) {
      return true;
    }
    return false;
  };

  return {
    base: '/',
    plugins: [
      nodePolyfills({
        exclude: ['fs'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
        protocolImports: true,
      }),
      manifestPlugin(),
      copyStaticAssets(mode),
    ],
    define: {
      'process.env': {},
      global: 'globalThis',
    },
    resolve: {
      alias: [
        { find: '@config', replacement: path.resolve(__dirname, './src/config') },
        { find: '@utils', replacement: path.resolve(__dirname, './src/utils') },
        { find: '@entries', replacement: path.resolve(__dirname, './src/entries') },
        { find: 'crypto', replacement: cryptoBrowserShim },
        { find: 'vm', replacement: require.resolve('vm-browserify') },
        { find: 'assert', replacement: require.resolve('assert') },
        { find: 'buffer', replacement: require.resolve('buffer') },
        { find: 'process/browser', replacement: require.resolve('process/browser') },
        { find: 'stream', replacement: require.resolve('stream-browserify') },
        { find: /^worker_threads$/, replacement: workerThreadsShim },
        { find: /^node:worker_threads$/, replacement: workerThreadsShim },
        { find: 'url', replacement: require.resolve('url') },
        { find: 'net', replacement: require.resolve('net-browserify') },
        { find: 'http', replacement: require.resolve('stream-http') },
        { find: 'https', replacement: require.resolve('https-browserify') },
        { find: 'os', replacement: emptyShim },
        { find: /^fs(?:\/.*)?$/, replacement: emptyShim },
        { find: /^node:fs(?:\/.*)?$/, replacement: emptyShim },
        { find: 'dns', replacement: emptyShim },
        { find: 'timers', replacement: emptyShim },
        { find: 'tls', replacement: emptyShim },
        { find: 'path', replacement: emptyShim },
        { find: 'zlib', replacement: emptyShim },
        { find: 'child_process', replacement: emptyShim },
        { find: /^koffi$/, replacement: emptyShim },
        { find: /^re2$/, replacement: re2Shim },
        { find: /^canvas$/, replacement: emptyShim },
      ],
    },
    server: {
      port: 5000,
      hmr: { overlay: false },
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Access-Control-Allow-Origin': '*',
      },
    },
    build: {
      outDir: 'build',
      ...(isDevBuild
        ? {
            minify: false,
            sourcemap: false,
            reportCompressedSize: false,
            chunkSizeWarningLimit: 2000,
          }
        : {
            chunkSizeWarningLimit: 6000,
          }),
      rollupOptions: {
        onwarn(warning, warn) {
          if (shouldIgnoreWarning(warning)) return;
          warn(warning);
        },
        input: {
          offscreen: path.resolve(__dirname, 'offscreen.html'),
          popup: path.resolve(__dirname, 'popup.html'),
          background: path.resolve(__dirname, 'src/entries/Background/index.ts'),
          contentScript: path.resolve(__dirname, 'src/entries/Content/index.ts'),
          contentScriptLoader: path.resolve(__dirname, 'src/entries/Content/contentScriptLoader.ts'),
          txClickGuide: path.resolve(__dirname, 'src/entries/Content/txClickGuide.ts'),
          txClickGuideLoader: path.resolve(__dirname, 'src/entries/Content/txClickGuideLoader.ts'),
          injectScript: path.resolve(__dirname, 'src/entries/Content/injectScript.ts'),
        },
        output: {
          entryFileNames: '[name].bundle.js',
          chunkFileNames: '[name].chunk.js',
        },
      },
    },
    optimizeDeps: {
      exclude: [
        'vite-plugin-node-polyfills/shims/buffer',
        'vite-plugin-node-polyfills/shims/global',
        'vite-plugin-node-polyfills/shims/process',
      ],
    },
  };
});
