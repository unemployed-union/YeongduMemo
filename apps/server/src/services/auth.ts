import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { createUserSchema, type Tokens } from '@yeongdu/shared';
import type { ServerDatabase } from '../database/index.js';
import { sessions, users } from '../database/schema.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const ACCESS_MS = 15 * 60_000;
const REFRESH_MS = 30 * 24 * 60 * 60_000;

export class AuthService {
  constructor(
    private db: ServerDatabase,
    private now = Date.now,
  ) {}

  async createUser(email: string, password: string) {
    const input = createUserSchema.parse({ email: email.trim().toLowerCase(), password });
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    const id = randomUUID();
    this.db.orm.insert(users).values({ id, email: input.email, passwordHash }).run();
    return id;
  }

  async login(email: string, password: string): Promise<Tokens | null> {
    const user = this.db.orm.select().from(users).where(eq(users.email, email.toLowerCase())).get();
    if (!user || !(await argon2.verify(user.passwordHash, password))) return null;
    return this.issue(user.id);
  }

  private issue(userId: string, sessionId: string = randomUUID()): Tokens {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = this.now() + ACCESS_MS;
    this.db.orm
      .insert(sessions)
      .values({
        id: sessionId,
        userId,
        accessHash: digest(accessToken),
        refreshHash: digest(refreshToken),
        accessExpires: expiresAt,
        refreshExpires: this.now() + REFRESH_MS,
      })
      .run();
    return { accessToken, refreshToken, expiresAt, userId };
  }

  refresh(token: string): Tokens | null {
    return this.db.sqlite.transaction(() => {
      this.db.sqlite.prepare('DELETE FROM used_refresh WHERE expires < ?').run(this.now());
      const hash = digest(token);
      const replay = this.db.sqlite
        .prepare('SELECT session_id FROM used_refresh WHERE hash = ?')
        .get(hash) as { session_id: string } | undefined;
      if (replay) {
        this.db.orm.delete(sessions).where(eq(sessions.id, replay.session_id)).run();
        return null;
      }
      const session = this.db.orm
        .select()
        .from(sessions)
        .where(eq(sessions.refreshHash, hash))
        .get();
      if (!session) return null;
      this.db.orm.delete(sessions).where(eq(sessions.id, session.id)).run();
      if (session.refreshExpires <= this.now()) return null;
      this.db.sqlite
        .prepare('INSERT INTO used_refresh VALUES (?, ?, ?)')
        .run(hash, session.id, session.refreshExpires);
      return this.issue(session.userId, session.id);
    })();
  }

  authenticate(access: string): string | null {
    const session = this.db.orm
      .select()
      .from(sessions)
      .where(eq(sessions.accessHash, digest(access)))
      .get();
    return session && session.accessExpires > this.now() ? session.userId : null;
  }

  logout(token: string) {
    this.db.orm
      .delete(sessions)
      .where(eq(sessions.accessHash, digest(token)))
      .run();
  }
}
