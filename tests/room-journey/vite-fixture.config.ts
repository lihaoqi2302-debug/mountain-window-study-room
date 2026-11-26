import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import projectConfig from '../../vite.config'

export default defineConfig((env) => {
  const scene = fileURLToPath(new URL('../../.public-room/bookstore/index.html', import.meta.url))
  if (env.mode !== 'public' || !existsSync(scene)) {
    throw new Error('Use public mode and run node scripts/prepare-bookstore.mjs public first')
  }
  const config = projectConfig(env)
  const testConfig = projectConfig({ ...env, mode: 'test' })
  return {
    ...config,
    server: { watch: null, hmr: false },
    plugins: [
      ...config.plugins,
      ...testConfig.plugins.filter((plugin) => 'name' in plugin && plugin.name === 'study-room-test-ice'),
      {
        name: 'room-journey-local-network-only',
        enforce: 'pre',
        configureServer(server) {
          // Public hosting resolves directory index files; Vite's dev SPA fallback does not.
          server.middlewares.use((req, _res, next) => {
            if (req.url === '/bookstore/') req.url = '/bookstore/index.html'
            next()
          })
        },
        transform(source, id) {
          // Public edition and public scene remain unchanged. Only the two networking
          // modules switch to the repository's already-existing local test branches.
          const path = id.split('?')[0].replaceAll('\\', '/')
          if (/\/src\/online\/(ice|roomSession)\.ts$/.test(path)) {
            return source.replaceAll('import.meta.env.MODE', JSON.stringify('test'))
          }
        },
      },
    ],
  }
})
