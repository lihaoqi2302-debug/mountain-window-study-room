import { defineConfig } from 'vite'
import type { Plugin, ResolvedConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function offlineBundle(refinedScene: boolean): Plugin {
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
      const groups: Record<string, string[]> = { core: files }
      const optional = refinedScene ? ['bookstore/index.html'] : [
        'models/study_room.glb', 'draco/draco_decoder.js', 'draco/draco_decoder.wasm', 'draco/draco_wasm_wrapper.js',
      ]
      for (const file of optional) {
        if (await stat(resolve(directory, file)).then((item) => item.isFile()).catch(() => false)) files.push(file)
      }
      if (refinedScene) {
        const bookstore = JSON.parse(await readFile(resolve(directory, 'bookstore/offline-assets.json'), 'utf8')) as Record<string, string[]>
        for (const [name, names] of Object.entries(bookstore)) {
          (groups[name] ??= []).push(...names.map((path) => 'bookstore/' + path))
        }
      }
      const code = await readFile(new URL('./src/offline/worker.js', import.meta.url), 'utf8')
      const version = createHash('sha256').update(code)
      const packs: Record<string, { files: Array<{ path: string; bytes: number }>; bytes: number }> = {}
      for (const [name, paths] of Object.entries(groups)) {
        if (!paths.length) continue
        version.update(name)
        const entries = []
        for (const file of paths.sort()) {
          const content = await readFile(resolve(directory, file))
          version.update(file).update(content)
          entries.push({ path: file, bytes: content.length })
        }
        packs[name] = { files: entries, bytes: entries.reduce((sum, { bytes }) => sum + bytes, 0) }
      }
      const revision = version.digest('hex').slice(0, 16)
      await writeFile(resolve(directory, 'sw.js'), `const revision = ${JSON.stringify(revision)};\nconst packs = ${JSON.stringify(packs)};\n${code}`)
      await writeFile(resolve(directory, 'offline-manifest.json'), JSON.stringify({ revision,
        packs: Object.fromEntries(Object.entries(packs).map(([name, pack]) => [name, { bytes: pack.bytes, files: pack.files.length }])),
      }, null, 2))
    },
  }
}

export default defineConfig(({ mode }) => {
  const refinedScene = mode === 'formal' || mode === 'public'
  return ({
  base: './',
  publicDir: mode === 'formal' ? '.formal' : mode === 'public' ? '.public-room' : 'public',
  plugins: [react(), tailwindcss(), offlineBundle(refinedScene)],
  build: {
    outDir: mode === 'formal' ? 'dist-formal' : mode === 'public' ? 'dist-public' : 'dist',
    target: ['es2022', 'safari16.4', 'chrome110'],
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
  })
})
