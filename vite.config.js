import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // This ensures Buffer and process are available for ethers/viem
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    outDir: 'build',
    commonjsOptions: {
      transformMixedEsModules: true, // Helps with mixed module types in web3 libs
    },
    rollupOptions: {
      // This suppresses the "annotation" warning you saw in the logs
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return;
        }
        warn(warning);
      },
    },
  },
});