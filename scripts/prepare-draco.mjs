import { copyFile, mkdir } from 'node:fs/promises'

const output = new URL('../public/draco/', import.meta.url)
await mkdir(output, { recursive: true })
const three = new URL('../node_modules/three/', import.meta.url)
await Promise.all([
  ...['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js'].map((file) =>
    copyFile(new URL(`examples/jsm/libs/draco/${file}`, three), new URL(file, output))),
  copyFile(new URL('LICENSE', three), new URL('LICENSE.three.txt', output)),
  copyFile(new URL('../licenses/Apache-2.0.txt', import.meta.url), new URL('LICENSE.draco.txt', output)),
])
