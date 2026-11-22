import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: mode === 'formal' ? '.formal' : 'public',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: mode === 'formal' ? 'dist-formal' : 'dist',
    target: 'esnext',
    minify: 'terser',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll('\\', '/')
          if (path.endsWith('/node_modules/three/build/three.core.js')) return 'three-core'
          if (path.includes('/node_modules/three/')) return 'three'
        },
      },
    },
  },
}))
