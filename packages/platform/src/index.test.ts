import { expect, test } from 'bun:test'
import { loadConfig } from './index.ts'

const baseEnv = { TECHSPAR_BASE_DIR: '/tmp/techspar-test', JWT_SECRET: 'test-secret' }

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
