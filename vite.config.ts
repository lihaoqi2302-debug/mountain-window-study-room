import { defineConfig } from 'vite'
import type { Plugin, ResolvedConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function offlineBundle(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'study-room-offline',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    async writeBundle() {
      const directory = resolve(config.root, config.build.outDir)
      const chunks = await readdir(resolve(directory, config.build.assetsDir))
      const files = ['index.html', ...chunks.filter((name) => /\.(?:js|css)$/.test(name))
        .map((name) => `${config.build.assetsDir}/${name}`)]
      const optional = config.mode === 'formal' ? ['bookstore/index.html']
        : ['models/study_room.glb', 'draco/draco_decoder.js', 'draco/draco_decoder.wasm', 'draco/draco_wasm_wrapper.js']
      for (const file of optional) {
        if (await stat(resolve(directory, file)).then((item) => item.isFile()).catch(() => false)) files.push(file)
      }
      const code = await readFile(new URL('./src/offline/worker.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(code)
      for (const file of files.sort()) {
        version.update(file).update(await readFile(resolve(directory, file)))
      }
      const revision = version.digest('hex').slice(0, 16)
      await writeFile(resolve(directory, 'sw.js'), `const revision = ${JSON.stringify(revision)};\nconst files = ${JSON.stringify(files)};\n${code}`)
    },
  }
}

export default defineConfig(({ mode }) => ({
  base: './',
  publicDir: mode === 'formal' ? '.formal' : 'public',
  plugins: [react(), tailwindcss(), offlineBundle()],
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
