import { describe, it, expect, beforeEach } from 'vitest'
import { isAuthorized } from '@/lib/http/adminAuth'

beforeEach(() => { process.env.ADMIN_TRIGGER_SECRET = 'sek' })

describe('isAuthorized', () => {
  it('accepts the matching bearer token', () => { expect(isAuthorized('Bearer sek')).toBe(true) })
  it('rejects a wrong or missing token', () => { expect(isAuthorized('Bearer nope')).toBe(false); expect(isAuthorized(null)).toBe(false) })
})
