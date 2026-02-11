import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import pkg from './package.json' with { type: 'json' }

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    define: {
        '__APP_VERSION__': JSON.stringify(pkg.version),
        '__DEV_BUILD__': mode !== 'production',
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    build: {
        outDir: 'dist-extension',
        emptyOutDir: true,
        chunkSizeWarningLimit: 3072, // 3MB - acceptable for Chrome extensions with Mermaid/Marpit
        rollupOptions: {
            input: {
                sidepanel: resolve(__dirname, 'sidepanel.html'),
                background: resolve(__dirname, 'src/background.ts'),
                'screenshot-content': resolve(__dirname, 'src/content/screenshot-content.ts'),
                'deeplink-content': resolve(__dirname, 'src/content/deeplink-content.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]',
            },
        },
    },
    publicDir: 'public',
}))
