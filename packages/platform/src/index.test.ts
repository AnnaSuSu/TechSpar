import { expect, test } from 'bun:test'
import { loadConfig } from './index.ts'

const baseEnv = {
  TECHSPAR_BASE_DIR: '/tmp/techspar-test',
  JWT_SECRET: 'test-jwt-secret-with-at-least-32-chars',
  VOICEPRINT_ENCRYPTION_KEY: 'test-voiceprint-key-with-at-least-32-chars',
  DEFAULT_PASSWORD: 'test-default-password',
}

test('Copilot credentials are isolated from general LLM and transcription settings', () => {
  const config = loadConfig({ ...baseEnv, PLATFORM_LLM_MODEL: 'general-model', PLATFORM_LLM_API_KEY: 'general-key', COPILOT_LLM_API_KEY: 'copilot-key', COPILOT_DASHSCOPE_API_KEY: 'asr-key', COPILOT_DASHSCOPE_WORKSPACE_ID: 'workspace' })
  expect(config.platformLlmModel).toBe('general-model')
  expect(config.platformLlmApiKey).toBe('general-key')
  expect(config.copilotLlm).toMatchObject({ model: 'deepseek-flash', api_key: 'copilot-key', api_base: 'https://api.deepseek.com', compatibility: 'deepseek', source: 'platform' })
  expect(config.copilotAsr).toEqual({ apiKey: 'asr-key', workspaceId: 'workspace' })
  expect(loadConfig(baseEnv).copilotLlm).toBeUndefined()
  expect(loadConfig(baseEnv).copilotAsr).toBeUndefined()
})

test('数字型环境变量缺省时回退到默认值', () => {
  const config = loadConfig({ ...baseEnv })
  expect(config.port).toBe(8000)
  expect(config.platformTokenLimit).toBe(0)
  expect(config.platformDailyCallLimit).toBe(0)
})

test('空白字符串视为未设置，回退到默认值', () => {
  const config = loadConfig({ ...baseEnv, PORT: '  ', PLATFORM_TOKEN_LIMIT: '' })
  expect(config.port).toBe(8000)
  expect(config.platformTokenLimit).toBe(0)
})

test('合法的数字字符串正常解析', () => {
  const config = loadConfig({ ...baseEnv, PORT: '9000', PLATFORM_TOKEN_LIMIT: '100000', PLATFORM_DAILY_CALL_LIMIT: '50' })
  expect(config.port).toBe(9000)
  expect(config.platformTokenLimit).toBe(100000)
  expect(config.platformDailyCallLimit).toBe(50)
})

// 配额上限解析出 NaN 时 NaN > 0 与 used >= NaN 均不成立，配额检查会静默失效，
// 等于把平台 key 敞开给全网——必须在启动期抛错，而不是放行。
test.each(['abc', '1o0', 'Infinity', 'NaN'])('PLATFORM_TOKEN_LIMIT=%s 为非法值时抛错', (raw) => {
  expect(() => loadConfig({ ...baseEnv, PLATFORM_TOKEN_LIMIT: raw })).toThrow('PLATFORM_TOKEN_LIMIT')
})

test('负数配额同样拒绝', () => {
  expect(() => loadConfig({ ...baseEnv, PLATFORM_DAILY_CALL_LIMIT: '-5' })).toThrow('PLATFORM_DAILY_CALL_LIMIT')
})

test('PORT 为非法值时抛错', () => {
  expect(() => loadConfig({ ...baseEnv, PORT: 'abc' })).toThrow('PORT')
  expect(() => loadConfig({ ...baseEnv, PORT: '-1' })).toThrow('PORT')
})

test('拒绝缺失、默认或过短的服务端凭据', () => {
  expect(() => loadConfig({ ...baseEnv, JWT_SECRET: 'change-me-in-production' })).toThrow('JWT_SECRET')
  expect(loadConfig({ ...baseEnv, VOICEPRINT_ENCRYPTION_KEY: baseEnv.JWT_SECRET }).voiceprintEncryptionKey).toBe(baseEnv.JWT_SECRET)
  expect(() => loadConfig({ ...baseEnv, DEFAULT_PASSWORD: 'admin123' })).toThrow('DEFAULT_PASSWORD')
  expect(() => loadConfig({ ...baseEnv, DEFAULT_PASSWORD: 'short' })).toThrow('DEFAULT_PASSWORD')
})

test('反向代理信任必须显式启用', () => {
  expect(loadConfig(baseEnv).trustProxy).toBeFalse()
  expect(loadConfig({ ...baseEnv, TRUST_PROXY: 'true' }).trustProxy).toBeTrue()
})
