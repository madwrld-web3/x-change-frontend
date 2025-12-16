import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Essential for Hyperliquid/Viem to work in the browser
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    outDir: 'build', // Matches your Vercel output setting
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // This function intercepts and silences specific warnings
      onwarn(warning, warn) {
        // Ignore the "annotation" warning from micro-eth-signer/viem
        if (warning.code === 'INVALID_ANNOTATION') {
          return;
        }
        // Ignore "Module level directive" warnings (common in React server components)
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return;
        }
        // Log everything else
        warn(warning);
      },
    },
  },
});