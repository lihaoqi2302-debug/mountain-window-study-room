export const keyDirections: Record<string, string> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
}

const pressed = new Map<string, string>()
export const press = (input: string, direction: string) => pressed.set(input, direction)
export const release = (input: string) => pressed.delete(input)
export const clearMovement = () => pressed.clear()

export function readMovement() {
  let x = 0
  let z = 0
  const directions = new Set(pressed.values())
  if (directions.has('left')) x--
  if (directions.has('right')) x++
  if (directions.has('up')) z--
  if (directions.has('down')) z++
  return { x, z }
}
