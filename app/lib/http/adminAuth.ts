import { timingSafeEqual } from 'node:crypto'

export function isAuthorized(authHeader: string | null): boolean {
  const secret = process.env.ADMIN_TRIGGER_SECRET
  if (!secret || !authHeader) return false
  const expected = `Bearer ${secret}`
  const a = Buffer.from(authHeader), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
