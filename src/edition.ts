export const refinedScene = ['formal', 'public'].includes(import.meta.env.MODE)
export const networkRoomId = import.meta.env.MODE === 'public' ? 'mountain-window-study-room/public-1'
  : refinedScene ? 'mountain-window-study-room/formal-2' : 'mountain-window-study-room/phase-1'
