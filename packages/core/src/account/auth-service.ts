import { AppError } from '../kernel/errors.ts'
import type { AuthUser } from './model.ts'
import type { AuthPolicy, AuthUseCases, IdGenerator, PasswordHasher, TokenService, UserRepository } from './ports.ts'

/** Authentication application service. It depends only on ports owned by core. */
export class AuthService implements AuthUseCases {
  constructor(
    private readonly users: UserRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly ids: IdGenerator,
    private readonly policy: AuthPolicy,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const row = await this.users.findByEmail(email)
    if (!row || !(await this.passwords.verify(password, row.password))) {
      throw new AppError('Invalid email or password', 401)
    }
    if (await this.users.tokenVersion(row.id) !== row.tokenVersion) throw new AppError('Invalid email or password', 401)
    const { password: _, tokenVersion, ...user } = row
    return { token: await this.tokens.create(user.id, tokenVersion), user }
  }

  async register(email: string, password: string, name: string): Promise<{ token: string; user: AuthUser }> {
    if (!this.policy.allowRegistration) throw new AppError('Registration is disabled', 403)
    if (await this.users.findByEmail(email)) throw new AppError('Email already registered', 409)
    const user = await this.users.create({
      id: this.ids.next(),
      email,
      password: await this.passwords.hash(password),
      name,
    })
    return { token: await this.tokens.create(user.id), user }
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{ status: 'ok' }> {
    const user = await this.users.findById(userId)
    const row = user ? await this.users.findByEmail(user.email) : undefined
    if (!row || !(await this.passwords.verify(currentPassword, row.password))) throw new AppError('Current password is incorrect', 400)
    if (await this.passwords.verify(newPassword, row.password)) throw new AppError('New password must be different', 400)
    await this.users.updatePassword(userId, await this.passwords.hash(newPassword))
    return { status: 'ok' }
  }
}
