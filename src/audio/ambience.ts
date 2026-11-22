export type AmbientSound = 'rain' | 'fire'

function makeAudioBuffer(context: AudioContext, kind: AmbientSound) {
  const fire = kind === 'fire'
  const buffer = context.createBuffer(1, context.sampleRate * (fire ? 11 : 5), context.sampleRate)
  const data = buffer.getChannelData(0)
  let filtered = 0
  let crackle = 0
  for (let i = 0; i < data.length; i++) {
    const noise = Math.random() * 2 - 1
    if (fire && Math.random() < .00049) crackle = Math.random() * .37
    crackle *= .989
    filtered = fire ? filtered * .978 + noise * .022 : filtered * .86 + noise * .14
    data[i] = fire ? filtered * .86 + noise * (crackle + .017) : filtered * .65 + noise * .06
  }
  return buffer
}

export async function makeAmbientPlayer(volume: number) {
  const context = new AudioContext()
  try {
    await context.resume()
    const gain = context.createGain()
    gain.gain.value = volume * .5
    gain.connect(context.destination)
    const buffers = new Map<AmbientSound, AudioBuffer>()
    let layer: { kind: AmbientSound; source: AudioBufferSourceNode; fade: GainNode } | null = null
    const fadeOut = () => {
      if (!layer) return
      const { source, fade } = layer
      fade.gain.setTargetAtTime(0, context.currentTime, .04)
      source.stop(context.currentTime + .17)
      source.onended = () => { source.disconnect(); fade.disconnect() }
      layer = null
    }
    return {
      setVolume: (value: number) => gain.gain.setTargetAtTime(value * .5, context.currentTime, .04),
      setSound: (kind: AmbientSound | 'quiet') => {
        if (layer?.kind === kind) return
        fadeOut()
        if (kind === 'quiet') return
        const buffer = buffers.get(kind) ?? makeAudioBuffer(context, kind)
        buffers.set(kind, buffer)
        const source = context.createBufferSource()
        const fade = context.createGain()
        source.buffer = buffer
        source.loop = true
        fade.gain.value = 0
        source.connect(fade).connect(gain)
        source.start()
        fade.gain.setTargetAtTime(1, context.currentTime, .07)
        layer = { kind, source, fade }
      },
      stop: () => {
        fadeOut()
        window.setTimeout(() => { void context.close() }, 210)
      },
    }
  } catch (error) {
    void context.close()
    throw error
  }
}

export async function startAmbientSound(kind: AmbientSound, volume: number) {
  const player = await makeAmbientPlayer(volume)
  player.setSound(kind)
  return player
}
