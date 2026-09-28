const responseFixtureRoot = 'tests-ts/contracts/fixtures/responses/'

export async function loadResponseFixture<T = unknown>(filename: string): Promise<T> {
  return await Bun.file(`${responseFixtureRoot}${filename}`).json() as T
}

export async function loadTextFixture(filename: string): Promise<string> {
  return await Bun.file(`tests-ts/contracts/fixtures/${filename}`).text()
}
