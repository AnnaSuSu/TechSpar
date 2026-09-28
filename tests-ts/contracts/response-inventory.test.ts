import { describe, expect, test } from 'bun:test'
import { inventoryOperations, responseInventory } from './response-inventory.ts'

describe('API response inventory', () => {
  test('has unique HTTP operations', () => {
    expect(new Set(inventoryOperations).size).toBe(inventoryOperations.length)
  })

  test('records a fixture for every JSON response family', () => {
    const missing = responseInventory
      .filter((entry) => entry.transport === 'json' && !entry.fixture)
      .map((entry) => entry.operation)
    expect(missing).toEqual([])
  })

  test('points only to checked-in fixture files', async () => {
    const missing = [] as string[]
    for (const entry of responseInventory) {
      if (!entry.fixture) continue
      const root = entry.fixture.includes('/') ? 'tests-ts/contracts/fixtures' : 'tests-ts/contracts/fixtures/responses'
      const path = `${root}/${entry.fixture}`
      if (!await Bun.file(path).exists()) missing.push(path)
    }
    expect(missing).toEqual([])
  })

  test('keeps JSON response fixtures parseable', async () => {
    const invalid = [] as string[]
    for (const entry of responseInventory) {
      if (!entry.fixture || entry.fixture.includes('/')) continue
      try { await Bun.file(`tests-ts/contracts/fixtures/responses/${entry.fixture}`).json() }
      catch { invalid.push(entry.fixture) }
    }
    expect(invalid).toEqual([])
  })

  test('marks current dynamic response surfaces for later tightening', () => {
    const dynamic = responseInventory.filter((entry) => entry.dynamic).map((entry) => entry.operation)
    expect(dynamic).toEqual(expect.arrayContaining([
      'POST /api/interview/start',
      'GET /api/profile',
      'GET /api/copilot/prep/{prep_id}',
    ]))
  })
})
