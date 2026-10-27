import { createApp, type AppDependencies } from '../apps/api/src/app.ts'

const unavailable = new Proxy({}, { get() { return () => Promise.reject(new Error('OpenAPI generation does not execute use cases')) } })
const dependencies = {
  auth: unavailable, registration: { allowRegistration: false }, settings: unavailable, settingsOperations: unavailable, quota: unavailable, tokens: unavailable,
  knowledge: unavailable, resume: unavailable, interview: unavailable, profile: unavailable, personalAgent: unavailable, migration: unavailable, recording: unavailable,
  copilotSessions: unavailable, copilotPrep: unavailable, copilotRealtime: unavailable, voiceprint: unavailable,
} as unknown as AppDependencies

const response = await createApp(dependencies).request('/openapi.json')
if (!response.ok) throw new Error(`OpenAPI generation failed: ${response.status} ${await response.text()}`)
const document = await response.json()
await Bun.write('packages/contracts/openapi.json', `${JSON.stringify(document, null, 2)}\n`)
console.log('Generated packages/contracts/openapi.json')
