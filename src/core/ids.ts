let counter = 0

export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 1296
  const rand = Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, '0')
  return `${prefix}_${rand}${counter.toString(36).padStart(2, '0')}`
}
