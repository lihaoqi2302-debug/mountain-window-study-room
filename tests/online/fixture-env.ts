const portOffset = Number(process.env.STUDY_TEST_PORT_OFFSET ?? '0')
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 50_000) {
  throw new Error('STUDY_TEST_PORT_OFFSET must be an integer from 0 to 50000')
}

export const directPort = 5181 + portOffset
export const forcedRelayPort = 5182 + portOffset
export const nostrPort = 7447 + portOffset
export const turnPort = 3478 + portOffset
export const nostrUrl = `ws://127.0.0.1:${nostrPort}`
export const icePath = '/__test/ice'
