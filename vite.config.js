import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteObfuscateFile } from 'vite-plugin-obfuscator'

export default defineConfig({
  plugins: [
    vue(),
    viteObfuscateFile({
      include: [/\.(js|mjs|ts)$/],
      exclude: [/node_modules/],
      apply: 'build',
      debugger: false,
      compact: true,
      simplify: true,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.5,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.3,
      numbersToExpressions: true,
      renameGlobals: false,
      selfDefending: false,
      disableConsoleOutput: false,
    }),
  ],
  build: {
    target: 'es2015',
    outDir: 'dist',
    assetsInlineLimit: 4096,
  },
})