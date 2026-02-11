/**
 * Vite configuration for PWA build
 * Builds a standalone Progressive Web App version of Procura
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const basePath = env.VITE_BASE_PATH || '/'

    return {
        base: basePath,
        plugins: [react()],
        resolve: {
            alias: {
                '@': resolve(__dirname, './src'),
            },
        },
        build: {
            outDir: 'dist-pwa',
            emptyOutDir: true,
            chunkSizeWarningLimit: 3072, // 3MB
            rollupOptions: {
                input: {
                    main: resolve(__dirname, 'index.html'),
                    'service-worker': resolve(__dirname, 'src/service-worker.ts'),
                },
                output: {
                    entryFileNames: (chunkInfo) => {
                        // Keep service worker at root level
                        if (chunkInfo.name === 'service-worker') {
                            return 'service-worker.js';
                        }
                        return 'assets/[name]-[hash].js';
                    },
                    chunkFileNames: 'assets/[name]-[hash].js',
                    assetFileNames: 'assets/[name]-[hash].[ext]',
                },
            },
        },
        publicDir: 'public',
    }
})
