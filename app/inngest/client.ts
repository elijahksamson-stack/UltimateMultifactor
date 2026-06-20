import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'ultimatemultifactor',
  name: 'UltimateMultifactor Screener',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

export type Events = {
  'screen/run.trigger': { data: { targetDate?: string } }
}
