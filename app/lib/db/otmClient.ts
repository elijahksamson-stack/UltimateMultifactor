import { Pool } from 'pg'
let pool: Pool | null = null
export function otmPool(): Pool {
  if (!pool) {
    const cs = process.env.OTM_DATABASE_URL
    if (!cs) throw new Error('OTM_DATABASE_URL must be set')
    pool = new Pool({ connectionString: cs, max: 8 })
  }
  return pool
}
