import fs from 'node:fs';
import path from 'node:path';

export type MembershipStatus =
  | 'creator'
  | 'administrator'
  | 'member'
  | 'restricted'
  | 'left'
  | 'kicked'
  | 'unknown';

export interface StoredUser {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  verifiedMember: boolean;
  lastMembershipStatus: MembershipStatus;
  lastMembershipCheckAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface StateShape {
  users: Record<string, StoredUser>;
}

const EMPTY_STATE: StateShape = { users: {} };

export class BotStorage {
  constructor(private readonly filePath: string) {
    this.ensureFile();
  }

  upsertUser(
    telegramId: number,
    patch: Partial<StoredUser> &
      Pick<StoredUser, 'firstName' | 'verifiedMember' | 'lastMembershipStatus'>,
  ): StoredUser {
    const now = new Date().toISOString();
    const state = this.read();
    const key = String(telegramId);
    const existing = state.users[key];

    const next: StoredUser = {
      telegramId,
      username: patch.username ?? existing?.username,
      firstName: patch.firstName ?? existing?.firstName,
      lastName: patch.lastName ?? existing?.lastName,
      verifiedMember: patch.verifiedMember,
      lastMembershipStatus: patch.lastMembershipStatus,
      lastMembershipCheckAt:
        patch.lastMembershipCheckAt ?? existing?.lastMembershipCheckAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    state.users[key] = next;
    this.write(state);
    return next;
  }

  getUser(telegramId: number): StoredUser | undefined {
    return this.read().users[String(telegramId)];
  }

  private ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(EMPTY_STATE, null, 2),
        'utf8',
      );
    }
  }

  private read(): StateShape {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    return raw ? (JSON.parse(raw) as StateShape) : EMPTY_STATE;
  }

  private write(state: StateShape) {
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }
}
