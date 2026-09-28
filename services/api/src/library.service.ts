import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException,
} from '@nestjs/common';
import { BookCondition, BookStatus, EmailCodePurpose, Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { requireEmailDelivery, sendAccountCode } from './email.js';

const ageMap: Record<string, 'AGE_4_6' | 'AGE_7_9' | 'AGE_10_12'> = {
  '3—6 岁': 'AGE_4_6', '6—9 岁': 'AGE_7_9', '9—12 岁': 'AGE_10_12',
};
const conditionMap: Record<string, BookCondition> = {
  '九成新': 'LIKE_NEW', '八成新': 'GOOD', '七成新': 'FAIR', '有明显使用痕迹': 'WELL_LOVED',
};
const ageLabel = Object.fromEntries(Object.entries(ageMap).map(([label, value]) => [value, label]));
const conditionLabel = Object.fromEntries(Object.entries(conditionMap).map(([label, value]) => [value, label]));

function text(value: unknown, name: string, max: number, required = false) {
  if (typeof value !== 'string') throw new BadRequestException(`${name}格式不正确`);
  const trimmed = value.trim();
  if (trimmed.length > max || (required && !trimmed)) throw new BadRequestException(`${name}长度不正确`);
  return trimmed;
}

function secret() {
  const value = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'local-development-secret-change-before-production');
  if (!value || value.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters');
  return value;
}

function digest(value: string) { return createHmac('sha256', secret()).update(value).digest('hex'); }
function same(a: string, b: string) {
  const left = Buffer.from(a, 'hex'); const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
function emailAddress(value: unknown) {
  const email = text(value, '邮箱', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('邮箱格式不正确');
  return email;
}
function usernameValue(value: unknown) {
  const username = text(value, '账号', 24, true).toLowerCase();
  if (!/^[a-z0-9_]{4,24}$/.test(username)) throw new BadRequestException('账号须为 4 到 24 位字母、数字或下划线');
  return username;
}
function passwordValue(value: unknown) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128 || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new BadRequestException('密码须为 10 到 128 位且不能包含控制字符');
  }
  return value;
}
function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await derivePassword(password, salt)).toString('hex')}`;
}
async function matchesPassword(password: string, encoded: string | null) {
  const parts = encoded?.split('$');
  const salt = parts?.length === 3 && parts[0] === 'scrypt' && /^[a-f0-9]{32}$/.test(parts[1]) ? Buffer.from(parts[1], 'hex') : Buffer.alloc(16);
  const expected = parts?.length === 3 && /^[a-f0-9]{128}$/.test(parts[2]) ? Buffer.from(parts[2], 'hex') : Buffer.alloc(64);
  const actual = await derivePassword(password, salt);
  return Boolean(encoded && parts?.[0] === 'scrypt' && timingSafeEqual(actual, expected));
}
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret()).digest(), iv);
  const encoded = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encoded]).toString('base64');
}
function decrypt(value: string | null) {
  if (!value) return '';
  const bytes = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret()).digest(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

@Injectable()
export class LibraryService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private expiryTimer?: ReturnType<typeof setInterval>;
  onModuleInit() {
    this.expiryTimer = setInterval(() => { void this.expireRequests().catch(error => console.error('Could not expire loan requests', error)); }, 60_000);
  }
  async onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer);
    await this.$disconnect();
  }

  async getFamily(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.sessionModelFind(digest(token));
    return session && session.expiresAt > new Date() && session.family.emailVerifiedAt ? session.family : null;
  }

  private sessionModelFind(tokenHash: string) {
    return this.session.findUnique({ where: { tokenHash }, include: { family: true } });
  }

  requireFamily(family: Awaited<ReturnType<LibraryService['getFamily']>>) {
    if (!family) throw new UnauthorizedException('请先登录');
    if (family.status !== 'ACTIVE') throw new ForbiddenException('账号不可用');
    return family;
  }

  async requestEmailCode(body: Record<string, unknown>) {
    const email = emailAddress(body.email);
    const purpose = body.purpose === 'register' ? EmailCodePurpose.REGISTER : body.purpose === 'reset' ? EmailCodePurpose.RESET : null;
    if (!purpose) throw new BadRequestException('验证码用途不正确');
    requireEmailDelivery();
    const emailHash = digest(`email:${email}`);
    if (purpose === EmailCodePurpose.REGISTER) {
      const allowlist = process.env.TEST_EMAIL_ALLOWLIST?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (process.env.NODE_ENV === 'production' && (!allowlist?.length || !allowlist.includes(email))) throw new ForbiddenException('测试站暂未开放注册');
      if (await this.family.findUnique({ where: { emailLookupHash: emailHash } })) throw new ConflictException('邮箱已注册');
    }
    const existing = await this.emailCode.findUnique({ where: { emailHash_purpose: { emailHash, purpose } } });
    const now = new Date();
    const recent = existing && now.getTime() - existing.windowStart.getTime() < 3600_000;
    if (existing && now.getTime() - existing.sentAt.getTime() < 60_000) throw new ConflictException('请一分钟后再试');
    if (recent && existing.sendCount >= 5) throw new ConflictException('发送次数过多，请稍后再试');
    if (process.env.NODE_ENV === 'production' && await this.emailCode.count({ where: { sentAt: { gt: new Date(now.getTime() - 3600_000) } } }) >= 100) throw new ConflictException('邮件服务繁忙，请稍后再试');
    const code = String(randomInt(100000, 1000000));
    const codeHash = digest(`email-code:${purpose}:${emailHash}:${code}`);
    await this.emailCode.upsert({
      where: { emailHash_purpose: { emailHash, purpose } },
      create: { emailHash, purpose, codeHash, expiresAt: new Date(now.getTime() + 10 * 60_000) },
      update: { codeHash, expiresAt: new Date(now.getTime() + 10 * 60_000), attempts: 0, sentAt: now, sendCount: recent ? { increment: 1 } : 1, windowStart: recent ? undefined : now },
    });
    const recipientExists = purpose === EmailCodePurpose.REGISTER || Boolean(await this.family.findUnique({ where: { emailLookupHash: emailHash } }));
    if (recipientExists) {
      try { await sendAccountCode(email, code, purpose); }
      catch {
        await this.emailCode.deleteMany({ where: { emailHash, purpose, codeHash } });
        throw new ConflictException('邮件发送失败，请稍后重试');
      }
    }
    return process.env.NODE_ENV === 'production' ? { sent: true } : { sent: true, developmentCode: code };
  }

  private async checkEmailCode(emailHash: string, purpose: EmailCodePurpose, code: unknown) {
    const value = text(code, '验证码', 6, true);
    if (!/^\d{6}$/.test(value)) throw new BadRequestException('验证码格式不正确');
    const record = await this.emailCode.findUnique({ where: { emailHash_purpose: { emailHash, purpose } } });
    if (!record || record.expiresAt <= new Date() || record.attempts >= 5) throw new UnauthorizedException('验证码已失效');
    const codeHash = digest(`email-code:${purpose}:${emailHash}:${value}`);
    if (!same(record.codeHash, codeHash)) {
      await this.emailCode.updateMany({ where: { emailHash, purpose, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('验证码不正确');
    }
    return codeHash;
  }

  async register(body: Record<string, unknown>) {
    const username = usernameValue(body.username);
    const email = emailAddress(body.email);
    const password = passwordValue(body.password);
    const nickname = body.nickname === undefined ? username : text(body.nickname, '书屋昵称', 30, true);
    const emailHash = digest(`email:${email}`);
    const codeHash = await this.checkEmailCode(emailHash, EmailCodePurpose.REGISTER, body.code);
    if (await this.family.findFirst({ where: { OR: [{ username }, { emailLookupHash: emailHash }] } })) throw new ConflictException('账号或邮箱已注册');
    const passwordHash = await hashPassword(password);
    const token = randomBytes(32).toString('hex');
    const family = await this.$transaction(async tx => {
      const consumed = await tx.emailCode.deleteMany({ where: { emailHash, purpose: EmailCodePurpose.REGISTER, codeHash, expiresAt: { gt: new Date() }, attempts: { lt: 5 } } });
      if (consumed.count !== 1) throw new UnauthorizedException('验证码已失效');
      const created = await tx.family.create({ data: { username, emailLookupHash: emailHash, emailCiphertext: encrypt(email), emailVerifiedAt: new Date(), passwordHash, displayName: nickname } });
      await tx.session.create({ data: { familyId: created.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) } });
      return created;
    });
    return { token, family: { id: family.id, displayName: family.displayName } };
  }

  async login(body: Record<string, unknown>) {
    const account = text(body.account, '账号', 254, true).toLowerCase();
    const password = passwordValue(body.password);
    const key = digest(`login:${account}`);
    const throttle = await this.authThrottle.findUnique({ where: { identifierHash: key } });
    if (throttle?.blockedUntil && throttle.blockedUntil > new Date()) throw new UnauthorizedException('账号或密码不正确，请稍后重试');
    const family = account.includes('@')
      ? await this.family.findUnique({ where: { emailLookupHash: digest(`email:${account}`) } })
      : await this.family.findUnique({ where: { username: account } });
    const valid = await matchesPassword(password, family?.passwordHash ?? null);
    if (!valid || !family || family.status !== 'ACTIVE' || !family.emailVerifiedAt) {
      const now = new Date();
      const recent = throttle && now.getTime() - throttle.windowStart.getTime() < 15 * 60_000;
      const attempts = recent ? throttle.attempts + 1 : 1;
      await this.authThrottle.upsert({ where: { identifierHash: key }, create: { identifierHash: key, attempts, windowStart: now, blockedUntil: attempts >= 10 ? new Date(now.getTime() + 15 * 60_000) : null }, update: { attempts, windowStart: recent ? undefined : now, blockedUntil: attempts >= 10 ? new Date(now.getTime() + 15 * 60_000) : null } });
      throw new UnauthorizedException('账号或密码不正确');
    }
    await this.authThrottle.deleteMany({ where: { identifierHash: key } });
    const token = randomBytes(32).toString('hex');
    await this.session.create({ data: { familyId: family.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) } });
    return { token, family: { id: family.id, displayName: family.displayName } };
  }

  async resetPassword(body: Record<string, unknown>) {
    const email = emailAddress(body.email);
    const password = passwordValue(body.password);
    const emailHash = digest(`email:${email}`);
    const codeHash = await this.checkEmailCode(emailHash, EmailCodePurpose.RESET, body.code);
    const family = await this.family.findUnique({ where: { emailLookupHash: emailHash } });
    if (!family || family.status !== 'ACTIVE') throw new UnauthorizedException('验证码已失效');
    const passwordHash = await hashPassword(password);
    await this.$transaction(async tx => {
      const consumed = await tx.emailCode.deleteMany({ where: { emailHash, purpose: EmailCodePurpose.RESET, codeHash, expiresAt: { gt: new Date() }, attempts: { lt: 5 } } });
      if (consumed.count !== 1) throw new UnauthorizedException('验证码已失效');
      await tx.family.update({ where: { id: family.id }, data: { passwordHash } });
      await tx.session.deleteMany({ where: { familyId: family.id } });
    });
    return { ok: true };
  }

  async logout(token?: string) {
    if (token && /^[a-f0-9]{64}$/.test(token)) await this.session.deleteMany({ where: { tokenHash: digest(token) } });
  }

  async me(familyId: string) {
    const family = await this.family.findUniqueOrThrow({ where: { id: familyId }, include: { children: true } });
    return { id: family.id, username: family.username, email: decrypt(family.emailCiphertext), displayName: family.displayName, children: family.children.map(child => ({ id: child.id, nickname: child.nickname, age: ageLabel[child.ageBand] ?? '其他', readingPreferences: child.readingPreferences })) };
  }

  async updateMe(familyId: string, body: Record<string, unknown>) {
    const displayName = text(body.displayName, '书屋昵称', 30, true);
    await this.family.update({ where: { id: familyId }, data: { displayName } });
    return this.me(familyId);
  }

  async addChild(familyId: string, body: Record<string, unknown>) {
    const nickname = text(body.nickname, '孩子昵称', 30, true);
    const age = text(body.age, '年龄段', 20, true);
    if (!ageMap[age]) throw new BadRequestException('年龄段不正确');
    const preferences = Array.isArray(body.readingPreferences) ? body.readingPreferences.map(value => text(value, '阅读偏好', 30, true)).slice(0, 10) : [];
    await this.childProfile.create({ data: { familyId, nickname, ageBand: ageMap[age], readingPreferences: preferences } });
    return this.me(familyId);
  }

  async removeChild(familyId: string, childId: string) {
    const removed = await this.childProfile.deleteMany({ where: { id: childId, familyId } });
    if (!removed.count) throw new NotFoundException('孩子档案不存在');
    return this.me(familyId);
  }

  async closeAccount(familyId: string) {
    await this.$transaction(async tx => {
      const activeLoans = await tx.loan.count({ where: { status: { in: ['REQUESTED', 'APPROVED', 'HANDOFF_AGREED', 'LENT', 'RETURN_REQUESTED'] }, OR: [{ ownerFamilyId: familyId }, { borrowerFamilyId: familyId }] } });
      if (activeLoans) throw new ConflictException('请先完成或取消进行中的借阅');
      await tx.book.updateMany({ where: { ownerFamilyId: familyId }, data: { status: 'OFF_SHELF' } });
      await tx.childProfile.deleteMany({ where: { familyId } });
      await tx.session.deleteMany({ where: { familyId } });
      await tx.family.update({ where: { id: familyId }, data: { status: 'CLOSED', phoneLookupHash: null, phoneCiphertext: null, username: null, emailLookupHash: null, emailCiphertext: null, emailVerifiedAt: null, passwordHash: null, displayName: '已注销书屋' } });
    });
    return { ok: true };
  }

  async books(familyId?: string) {
    await this.expireRequests();
    const rows = await this.book.findMany({ where: { OR: [{ status: { notIn: ['DRAFT', 'OFF_SHELF'] } }, ...(familyId ? [{ ownerFamilyId: familyId }] : [])] }, include: { ownerFamily: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(row => this.bookView(row, familyId));
  }

  private bookView(row: Prisma.BookGetPayload<{ include: { ownerFamily: { select: { displayName: true } } } }>, familyId?: string) {
    return { id: row.id, title: row.title, author: row.author ?? '作者待确认', category: row.category ?? '其他', age: ageLabel[row.suggestedAgeBand ?? ''] ?? '待确认', condition: conditionLabel[row.condition], owner: row.ownerFamily.displayName, summary: row.summary ?? '', available: row.status === 'AVAILABLE', offShelf: row.status === 'OFF_SHELF', mine: row.ownerFamilyId === familyId, tone: 'mint' };
  }

  async createBook(familyId: string, body: Record<string, unknown>) {
    if (body.privacyConfirmed !== true) throw new BadRequestException('请先核对图书内容与隐私');
    const title = text(body.title, '书名', 100, true);
    const author = text(body.author ?? '', '作者', 100);
    const category = text(body.category ?? '其他', '分类', 30, true);
    const age = text(body.age, '年龄段', 20, true);
    const condition = text(body.condition, '新旧程度', 30, true);
    const summary = text(body.summary ?? '', '简介', 1000);
    if (!ageMap[age] || !conditionMap[condition]) throw new BadRequestException('年龄段或新旧程度不正确');
    const row = await this.book.create({ data: { ownerFamilyId: familyId, title, author, category, suggestedAgeBand: ageMap[age], condition: conditionMap[condition], summary, status: 'AVAILABLE' }, include: { ownerFamily: { select: { displayName: true } } } });
    return this.bookView(row, familyId);
  }

  async setBookStatus(familyId: string, bookId: string, status: 'AVAILABLE' | 'OFF_SHELF') {
    const result = await this.book.updateMany({ where: { id: bookId, ownerFamilyId: familyId, status: { in: ['AVAILABLE', 'OFF_SHELF'] } }, data: { status } });
    if (!result.count) throw new ConflictException('仅可管理自己未借出的图书');
    return { ok: true };
  }

  async loans(familyId: string) {
    await this.expireRequests();
    const rows = await this.loan.findMany({ where: { OR: [{ ownerFamilyId: familyId }, { borrowerFamilyId: familyId }] }, include: { book: true, ownerFamily: { select: { displayName: true } }, borrowerFamily: { select: { displayName: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map(row => ({ id: row.id, bookId: row.bookId, bookTitle: row.book.title, owner: row.ownerFamily.displayName, borrower: row.borrowerFamily.displayName, isOwner: row.ownerFamilyId === familyId, stage: row.status, place: decrypt(row.handoffDetailsCiphertext), borrowerLoanConfirmed: !!row.borrowerLentConfirmedAt, ownerLoanConfirmed: !!row.ownerLentConfirmedAt, borrowerReturnConfirmed: !!row.borrowerReturnConfirmedAt, ownerReturnConfirmed: !!row.ownerReturnConfirmedAt, renewalRequested: !!row.renewalRequestedAt, renewed: !!row.renewedAt, dueAt: row.dueAt?.toISOString() ?? null, requestedAt: row.requestedAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null, lentAt: row.lentAt?.toISOString() ?? null, returnedAt: row.returnedAt?.toISOString() ?? null }));
  }

  async apply(familyId: string, bookId: string) {
    await this.expireRequests();
    return this.$transaction(async tx => {
      const claimed = await tx.book.updateMany({ where: { id: bookId, status: 'AVAILABLE', ownerFamilyId: { not: familyId } }, data: { status: 'RESERVED' } });
      if (!claimed.count) throw new ConflictException('这本书暂不可申请');
      const book = await tx.book.findUniqueOrThrow({ where: { id: bookId } });
      const loan = await tx.loan.create({ data: { bookId, ownerFamilyId: book.ownerFamilyId, borrowerFamilyId: familyId, status: 'REQUESTED' } });
      return { id: loan.id };
    });
  }

  private async expireRequests() {
    const cutoff = new Date(Date.now() - 48 * 3600_000);
    const expired = await this.loan.findMany({ where: { status: 'REQUESTED', requestedAt: { lt: cutoff } }, select: { id: true, bookId: true } });
    for (const loan of expired) await this.$transaction(async tx => {
      const changed = await tx.loan.updateMany({ where: { id: loan.id, status: 'REQUESTED' }, data: { status: 'EXPIRED' } });
      if (changed.count) await tx.book.update({ where: { id: loan.bookId }, data: { status: 'AVAILABLE' } });
    });
  }

  async act(familyId: string, loanId: string, body: Record<string, unknown>) {
    await this.expireRequests();
    const action = text(body.action, '操作', 30, true);
    return this.$transaction(async tx => {
      const loan = await tx.loan.findUnique({ where: { id: loanId } });
      if (!loan) throw new NotFoundException('借阅记录不存在');
      const owner = loan.ownerFamilyId === familyId;
      const borrower = loan.borrowerFamilyId === familyId;
      if (!owner && !borrower) throw new ForbiddenException('无权处理此借阅');
      const now = new Date();
      const expected = loan.status;
      let data: Prisma.LoanUpdateManyMutationInput = {};
      let bookStatus: BookStatus | undefined;
      if (action === 'approve' && owner && expected === 'REQUESTED') {
        const place = text(body.place, '公共交接地点', 120, true);
        data = { status: 'HANDOFF_AGREED', approvedAt: now, handoffDetailsCiphertext: encrypt(place) };
      }
      else if (action === 'decline' && owner && expected === 'REQUESTED') { data = { status: 'REJECTED' }; bookStatus = 'AVAILABLE'; }
      else if (action === 'cancel' && borrower && expected === 'REQUESTED') { data = { status: 'CANCELLED' }; bookStatus = 'AVAILABLE'; }
      else if (action === 'set-place' && owner && (expected === 'APPROVED' || expected === 'HANDOFF_AGREED') && !loan.ownerLentConfirmedAt && !loan.borrowerLentConfirmedAt) {
        const place = text(body.place, '公共交接地点', 120, true);
        data = { handoffDetailsCiphertext: encrypt(place), status: 'HANDOFF_AGREED' };
      } else if (action === 'confirm-lend' && expected === 'HANDOFF_AGREED' && loan.handoffDetailsCiphertext) {
        if (borrower && !loan.borrowerLentConfirmedAt) data = { borrowerLentConfirmedAt: now };
        else if (owner && loan.borrowerLentConfirmedAt && !loan.ownerLentConfirmedAt) data = { ownerLentConfirmedAt: now };
        if (Object.keys(data).length) { data = { ...data, status: 'LENT', lentAt: now, dueAt: new Date(now.getTime() + 14 * 24 * 3600_000) }; bookStatus = 'ON_LOAN'; }
      } else if (action === 'request-return' && borrower && expected === 'LENT' && !loan.borrowerReturnConfirmedAt) {
        data = { borrowerReturnConfirmedAt: now, renewalRequestedAt: null, status: 'RETURN_REQUESTED' };
      } else if (action === 'confirm-return' && owner && (expected === 'LENT' || expected === 'RETURN_REQUESTED')) {
        data = { ownerReturnConfirmedAt: loan.ownerReturnConfirmedAt ?? now, status: 'RETURNED', returnedAt: now };
        bookStatus = 'AVAILABLE';
      } else if (action === 'request-renew' && borrower && expected === 'LENT' && !loan.renewalRequestedAt && !loan.renewedAt) data = { renewalRequestedAt: now };
      else if (action === 'approve-renew' && owner && expected === 'LENT' && loan.renewalRequestedAt && !loan.renewedAt) data = { renewedAt: now, dueAt: new Date((loan.dueAt ?? now).getTime() + 14 * 24 * 3600_000) };
      if (!Object.keys(data).length) throw new ConflictException('当前状态不允许此操作，或已处理过');
      const changed = await tx.loan.updateMany({ where: { id: loanId, status: expected, updatedAt: loan.updatedAt }, data });
      if (!changed.count) throw new ConflictException('借阅状态已变化，请刷新');
      if (bookStatus) await tx.book.update({ where: { id: loan.bookId }, data: { status: bookStatus } });
      return { ok: true };
    });
  }
}
