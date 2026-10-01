import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException,
} from '@nestjs/common';
import { BookStatus, EmailCodePurpose, OptionKind, Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { requireEmailDelivery, sendAccountCode } from './email.js';
import { decodeCover, recognizeCover, summarizeBook } from './book-assist.js';

const bookInclude = { series: true, ownerFamily: { select: { displayName: true } }, categoryOption: true, ageOption: true, conditionOption: true } as const;
type BookRow = Omit<Prisma.BookGetPayload<{ include: typeof bookInclude }>, 'coverData'>;

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
function phoneNumber(value: unknown) {
  const input = text(value, '联系电话', 24, true).replace(/[\s()-]/g, '');
  const number = /^1[3-9]\d{9}$/.test(input) ? `+86${input}` : input;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new BadRequestException('请输入有效的联系电话，例如 13800138000');
  return number;
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

  async options(includeInactive = true) {
    const rows = await this.catalogOption.findMany({ where: includeInactive ? {} : { active: true }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }] });
    return {
      categories: rows.filter(row => row.kind === 'CATEGORY'),
      ages: rows.filter(row => row.kind === 'AGE'),
      conditions: rows.filter(row => row.kind === 'CONDITION'),
    };
  }

  private async resolveOption(kind: OptionKind, value: unknown, currentId?: string | null) {
    const input = text(value, '选项', 100, true);
    const option = await this.catalogOption.findFirst({ where: { kind, OR: [{ id: input }, { label: input }] } });
    if (!option || (!option.active && option.id !== currentId)) throw new BadRequestException('所选选项已停用或不存在');
    return option;
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
    const phone = phoneNumber(body.phone);
    const emailHash = digest(`email:${email}`);
    const codeHash = await this.checkEmailCode(emailHash, EmailCodePurpose.REGISTER, body.code);
    if (await this.family.findFirst({ where: { OR: [{ username }, { emailLookupHash: emailHash }] } })) throw new ConflictException('账号或邮箱已注册');
    const passwordHash = await hashPassword(password);
    const token = randomBytes(32).toString('hex');
    const family = await this.$transaction(async tx => {
      const consumed = await tx.emailCode.deleteMany({ where: { emailHash, purpose: EmailCodePurpose.REGISTER, codeHash, expiresAt: { gt: new Date() }, attempts: { lt: 5 } } });
      if (consumed.count !== 1) throw new UnauthorizedException('验证码已失效');
      const created = await tx.family.create({ data: { username, emailLookupHash: emailHash, emailCiphertext: encrypt(email), phoneCiphertext: encrypt(phone), emailVerifiedAt: new Date(), passwordHash, displayName: nickname } });
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
    const family = await this.family.findUniqueOrThrow({ where: { id: familyId }, include: { children: { include: { ageOption: true } } } });
    return { id: family.id, username: family.username, email: decrypt(family.emailCiphertext), phone: decrypt(family.phoneCiphertext), phoneVerified: false, displayName: family.displayName, children: family.children.map(child => ({ id: child.id, nickname: child.nickname, age: child.ageOption.label, ageOptionId: child.ageOptionId, readingPreferences: child.readingPreferences })) };
  }

  async updateMe(familyId: string, body: Record<string, unknown>) {
    const displayName = text(body.displayName, '书屋昵称', 30, true);
    const phoneCiphertext = body.phone === undefined ? undefined : encrypt(phoneNumber(body.phone));
    await this.family.update({ where: { id: familyId }, data: { displayName, phoneCiphertext } });
    return this.me(familyId);
  }

  async addChild(familyId: string, body: Record<string, unknown>) {
    const nickname = text(body.nickname, '孩子昵称', 30, true);
    const age = await this.resolveOption(OptionKind.AGE, body.ageOptionId ?? body.age);
    const preferences = Array.isArray(body.readingPreferences) ? body.readingPreferences.map(value => text(value, '阅读偏好', 30, true)).slice(0, 10) : [];
    await this.childProfile.create({ data: { familyId, nickname, ageOptionId: age.id, readingPreferences: preferences } });
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

  private pagination(query: Record<string, string>) {
    const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 100);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new BadRequestException('分页参数不正确');
    return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
  }

  async books(familyId?: string, query: Record<string, string> = {}) {
    await this.expireRequests();
    const where: Prisma.BookWhereInput = { ownerFamily: { status: 'ACTIVE' }, OR: [{ status: { notIn: ['DRAFT', 'OFF_SHELF'] } }, ...(familyId ? [{ ownerFamilyId: familyId }] : [])] };
    const paging = this.pagination(query);
    const rows = await this.book.findMany({ where, include: bookInclude, omit: { coverData: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: query.page ? paging.skip : 0, take: query.page ? paging.take : 200 });
    const items = rows.map(row => this.bookView(row, familyId));
    return query.page ? { items, total: await this.book.count({ where }), page: paging.page, pageSize: paging.pageSize } : items;
  }

  async shop(id: string) {
    const shop = await this.family.findFirst({ where: { id, status: 'ACTIVE' }, select: { id: true, displayName: true } });
    if (!shop) throw new NotFoundException('书屋不存在');
    return shop;
  }

  async shopBooks(id: string, query: Record<string, string> = {}, familyId?: string) {
    await this.shop(id);
    await this.expireRequests();
    const paging = this.pagination(query);
    const where: Prisma.BookWhereInput = { ownerFamilyId: id, status: { notIn: ['DRAFT', 'OFF_SHELF'] } };
    const rows = await this.book.findMany({ where, include: bookInclude, omit: { coverData: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: paging.skip, take: paging.take });
    return { items: rows.map(row => this.bookView(row, familyId)), total: await this.book.count({ where }), page: paging.page, pageSize: paging.pageSize };
  }

  async bookDetail(id: string, familyId?: string) {
    const row = await this.book.findFirst({ where: { id, ownerFamily: { status: 'ACTIVE' }, OR: [{ status: { notIn: ['DRAFT', 'OFF_SHELF'] } }, ...(familyId ? [{ ownerFamilyId: familyId }] : [])] }, include: bookInclude, omit: { coverData: true } });
    if (!row) throw new NotFoundException('图书不存在或已下架');
    return this.bookView(row, familyId);
  }

  private async seriesFields(familyId: string, body: Record<string, unknown>) {
    if (body.seriesId === undefined && body.seriesOrder === undefined) return {};
    if (body.seriesId != null && typeof body.seriesId !== 'string') throw new BadRequestException('系列格式不正确');
    const seriesId = body.seriesId ? text(body.seriesId, '系列', 100, true) : null;
    if (seriesId && !await this.bookSeries.findFirst({ where: { id: seriesId, ownerFamilyId: familyId } })) throw new BadRequestException('请选择本书屋的系列');
    if (body.seriesOrder != null && typeof body.seriesOrder !== 'number' && typeof body.seriesOrder !== 'string') throw new BadRequestException('册序格式不正确');
    const seriesOrder = body.seriesOrder == null || body.seriesOrder === '' ? null : Number(body.seriesOrder);
    if (seriesOrder !== null && (!Number.isSafeInteger(seriesOrder) || seriesOrder < 1 || seriesOrder > 10000)) throw new BadRequestException('册序须为1到10000的整数');
    return { seriesId, seriesOrder: seriesId ? seriesOrder : null };
  }

  async organizeSeries(familyId: string, body: Record<string, unknown>) {
    const name = text(body.name, '系列名称', 100, true);
    const summary = text(body.summary ?? '', '系列介绍', 1000);
    const ids = this.bookIds(body.bookIds);
    return this.$transaction(async tx => {
      const rows = await tx.book.findMany({ where: { id: { in: ids }, ownerFamilyId: familyId }, select: { id: true } });
      if (rows.length !== ids.length) throw new ForbiddenException('只能整理自己书屋的图书');
      const series = await tx.bookSeries.create({ data: { ownerFamilyId: familyId, name, summary } });
      await tx.book.updateMany({ where: { id: { in: ids }, ownerFamilyId: familyId }, data: { seriesId: series.id, seriesOrder: null } });
      return series;
    });
  }

  private bookIds(value: unknown) {
    if (!Array.isArray(value) || !value.length || value.length > 200 || value.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(value).size !== value.length) throw new BadRequestException('请选择1到200本不同的图书');
    return [...value] as string[];
  }

  private bookView(row: BookRow, familyId?: string) {
    return { id: row.id, shopId: row.ownerFamilyId, series: row.series ? { id: row.series.id, name: row.series.name, summary: row.series.summary } : null, seriesOrder: row.seriesOrder, status: row.status, title: row.title, author: row.author ?? '', category: row.categoryOption?.label ?? '其他', categoryOptionId: row.categoryOptionId, age: row.ageOption?.label ?? '待确认', ageOptionId: row.ageOptionId, condition: row.conditionOption.label, conditionOptionId: row.conditionOptionId, owner: row.ownerFamily.displayName, summary: row.summary ?? '', nonChildren: row.nonChildren, coverUrl: row.coverMimeType ? `/api/books/${row.id}/cover?v=${row.updatedAt.getTime()}` : null, available: row.status === 'AVAILABLE', offShelf: row.status === 'OFF_SHELF', editable: row.ownerFamilyId === familyId && ['AVAILABLE', 'OFF_SHELF'].includes(row.status), mine: row.ownerFamilyId === familyId, tone: 'mint' };
  }

  async cover(bookId: string, familyId?: string) {
    const book = await this.book.findUnique({ where: { id: bookId }, select: { ownerFamilyId: true, status: true, coverMimeType: true, coverData: true } });
    if (!book?.coverData || !book.coverMimeType || ((book.status === 'DRAFT' || book.status === 'OFF_SHELF') && book.ownerFamilyId !== familyId)) throw new NotFoundException('封面不存在');
    return { mimeType: book.coverMimeType, data: Buffer.from(book.coverData) };
  }

  async recognizeBookCover(body: Record<string, unknown>) {
    const image = await decodeCover(body.coverImage);
    const metadata = await recognizeCover(image);
    if (!metadata.title) return { ...metadata, summary: '', sources: [], notice: '未能从封面确认书名，请手动填写' };
    try {
      return { ...metadata, ...await summarizeBook(metadata.title, metadata.author) };
    } catch {
      return { ...metadata, summary: '', sources: [], notice: '已识别封面；简介暂未查到可靠资料，可手动填写或稍后重试' };
    }
  }

  async summarizeBookDetails(body: Record<string, unknown>) {
    return summarizeBook(text(body.title, '书名', 100, true), text(body.author ?? '', '作者', 100));
  }

  async createBook(familyId: string, body: Record<string, unknown>) {
    if (body.privacyConfirmed !== true) throw new BadRequestException('请先核对图书内容与隐私');
    const title = text(body.title, '书名', 100, true);
    const author = text(body.author ?? '', '作者', 100);
    const category = await this.resolveOption(OptionKind.CATEGORY, body.categoryOptionId ?? body.category ?? '其他');
    const age = await this.resolveOption(OptionKind.AGE, body.ageOptionId ?? body.age);
    const condition = await this.resolveOption(OptionKind.CONDITION, body.conditionOptionId ?? body.condition);
    const summary = text(body.summary ?? '', '简介', 1000);
    if (body.nonChildren !== undefined && typeof body.nonChildren !== 'boolean') throw new BadRequestException('读物标记不正确');
    const cover = body.coverImage == null ? null : await decodeCover(body.coverImage);
    const series = await this.seriesFields(familyId, body);
    const row = await this.book.create({ data: { ...series, ownerFamilyId: familyId, title, author, categoryOptionId: category.id, ageOptionId: age.id, conditionOptionId: condition.id, summary, nonChildren: body.nonChildren === true, coverMimeType: cover?.mimeType, coverData: cover?.data, status: 'AVAILABLE' }, include: bookInclude, omit: { coverData: true } });
    return this.bookView(row, familyId);
  }

  async editBook(familyId: string, bookId: string, body: Record<string, unknown>) {
    const previous = await this.book.findUnique({ where: { id: bookId }, select: { ownerFamilyId: true, status: true, updatedAt: true, categoryOptionId: true, ageOptionId: true, conditionOptionId: true } });
    if (!previous || previous.ownerFamilyId !== familyId) throw new NotFoundException('图书不存在');
    if (!['AVAILABLE', 'OFF_SHELF'].includes(previous.status)) throw new ConflictException('借阅申请或借出期间不能编辑图书');
    const [category, age, condition] = await Promise.all([
      this.resolveOption(OptionKind.CATEGORY, body.categoryOptionId ?? body.category, previous.categoryOptionId),
      this.resolveOption(OptionKind.AGE, body.ageOptionId ?? body.age, previous.ageOptionId),
      this.resolveOption(OptionKind.CONDITION, body.conditionOptionId ?? body.condition, previous.conditionOptionId),
    ]);
    const cover = body.coverImage === undefined || body.coverImage === null ? null : await decodeCover(body.coverImage);
    if (body.nonChildren !== undefined && typeof body.nonChildren !== 'boolean') throw new BadRequestException('读物标记不正确');
    const series = await this.seriesFields(familyId, body);
    const data: Prisma.BookUncheckedUpdateManyInput = { ...series,
      title: text(body.title, '书名', 100, true), author: text(body.author ?? '', '作者', 100),
      summary: text(body.summary ?? '', '简介', 1000), ...(body.nonChildren !== undefined ? { nonChildren: body.nonChildren } : {}), categoryOptionId: category.id,
      ageOptionId: age.id, conditionOptionId: condition.id,
      ...(cover ? { coverMimeType: cover.mimeType, coverData: cover.data } : {}),
    };
    const changed = await this.book.updateMany({ where: { id: bookId, ownerFamilyId: familyId, status: { in: ['AVAILABLE', 'OFF_SHELF'] }, updatedAt: previous.updatedAt }, data });
    if (!changed.count) throw new ConflictException('图书状态已变化，请刷新后重试');
    return this.bookView(await this.book.findUniqueOrThrow({ where: { id: bookId }, include: bookInclude, omit: { coverData: true } }), familyId);
  }

  async setBookStatus(familyId: string, bookId: string, status: 'AVAILABLE' | 'OFF_SHELF') {
    const result = await this.book.updateMany({ where: { id: bookId, ownerFamilyId: familyId, status: { in: ['AVAILABLE', 'OFF_SHELF'] } }, data: { status } });
    if (!result.count) throw new ConflictException('仅可管理自己未借出的图书');
    return { ok: true };
  }

  async loans(familyId: string) {
    await this.expireRequests();
    const rows = await this.loan.findMany({ where: { OR: [{ ownerFamilyId: familyId }, { borrowerFamilyId: familyId }] }, include: { group: true, book: { select: { title: true } }, ownerFamily: { select: { displayName: true, phoneCiphertext: true } }, borrowerFamily: { select: { displayName: true, phoneCiphertext: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    return rows.map(row => ({ id: row.id, groupId: row.groupId, message: row.group?.message ?? '', bookId: row.bookId, bookTitle: row.book.title, owner: row.ownerFamily.displayName, borrower: row.borrowerFamily.displayName, isOwner: row.ownerFamilyId === familyId, stage: row.status, place: decrypt(row.handoffDetailsCiphertext), contactPhone: ['HANDOFF_AGREED', 'LENT', 'RETURN_REQUESTED'].includes(row.status) ? decrypt(row.ownerFamilyId === familyId ? row.borrowerFamily.phoneCiphertext : row.ownerFamily.phoneCiphertext) : null, borrowerLoanConfirmed: !!row.borrowerLentConfirmedAt, ownerLoanConfirmed: !!row.ownerLentConfirmedAt, borrowerReturnConfirmed: !!row.borrowerReturnConfirmedAt, ownerReturnConfirmed: !!row.ownerReturnConfirmedAt, renewalRequested: !!row.renewalRequestedAt, renewed: !!row.renewedAt, dueAt: row.dueAt?.toISOString() ?? null, requestedAt: row.requestedAt.toISOString(), approvedAt: row.approvedAt?.toISOString() ?? null, lentAt: row.lentAt?.toISOString() ?? null, returnedAt: row.returnedAt?.toISOString() ?? null }));
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

  async applyGroup(familyId: string, body: Record<string, unknown>) {
    await this.expireRequests();
    const ids = this.bookIds(body.bookIds).sort();
    const shopId = text(body.shopId, '书屋', 100, true);
    if (shopId === familyId) throw new BadRequestException('不能向自己的书屋申请');
    const key = text(body.idempotencyKey, '请求编号', 100, true);
    const message = text(body.message ?? '', '留言', 500);
    const fingerprint = createHash('sha256').update(JSON.stringify([shopId, ids, message])).digest('hex');
    return this.$transaction(async tx => {
      // Serialize retries for a borrower; all entry points claim books with conditional writes.
      await tx.$queryRaw`SELECT id FROM "Family" WHERE id = ${familyId} FOR UPDATE`;
      const existing = await tx.loanGroup.findUnique({ where: { borrowerFamilyId_idempotencyKey: { borrowerFamilyId: familyId, idempotencyKey: key } } });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new ConflictException('请求编号已用于另一份申请');
        return { id: existing.id };
      }
      const shop = await tx.family.findFirst({ where: { id: shopId, status: 'ACTIVE' } });
      if (!shop) throw new NotFoundException('书屋不存在');
      const rows = await tx.book.findMany({ where: { id: { in: ids } }, select: { id: true, ownerFamilyId: true, status: true } });
      if (rows.length !== ids.length || rows.some(row => row.ownerFamilyId !== shopId)) throw new BadRequestException('一次只能申请同一家书屋的图书');
      const unavailableIds = rows.filter(row => row.status !== 'AVAILABLE').map(row => row.id);
      if (unavailableIds.length) throw new ConflictException({ message: '部分图书已不可借，请检查清单', unavailableIds });
      // Stable lock order prevents overlapping batches from deadlocking.
      for (const id of ids) {
        const claimed = await tx.book.updateMany({ where: { id, ownerFamilyId: shopId, status: 'AVAILABLE' }, data: { status: 'RESERVED' } });
        if (!claimed.count) throw new ConflictException({ message: '部分图书已不可借，请检查清单', unavailableIds: [id] });
      }
      const group = await tx.loanGroup.create({ data: { ownerFamilyId: shopId, borrowerFamilyId: familyId, idempotencyKey: key, requestFingerprint: fingerprint, message } });
      await tx.loan.createMany({ data: ids.map(bookId => ({ bookId, groupId: group.id, ownerFamilyId: shopId, borrowerFamilyId: familyId })) });
      return { id: group.id };
    });
  }

  async actGroup(familyId: string, groupId: string, body: Record<string, unknown>) {
    await this.expireRequests();
    const action = text(body.action, '操作', 30, true);
    return this.$transaction(async tx => {
      const group = await tx.loanGroup.findUnique({ where: { id: groupId }, include: { loans: { orderBy: { id: 'asc' } } } });
      if (!group) throw new NotFoundException('申请不存在');
      if (group.ownerFamilyId !== familyId && group.borrowerFamilyId !== familyId) throw new ForbiddenException('无权处理此申请');
      const eligible = group.loans.filter(loan => action === 'approve' || action === 'decline' || action === 'cancel' ? loan.status === 'REQUESTED'
        : action === 'confirm-lend' ? loan.status === 'HANDOFF_AGREED' && !loan.borrowerLentConfirmedAt
        : action === 'confirm-return' ? ['LENT', 'RETURN_REQUESTED'].includes(loan.status)
        : action === 'request-return' ? loan.status === 'LENT' && !loan.borrowerReturnConfirmedAt
        : action === 'request-renew' ? loan.status === 'LENT' && !loan.renewalRequestedAt && !loan.renewedAt
        : action === 'approve-renew' ? loan.status === 'LENT' && !!loan.renewalRequestedAt && !loan.renewedAt
        : action === 'set-place' ? loan.status === 'HANDOFF_AGREED' && !loan.borrowerLentConfirmedAt : false);
      const ids = body.loanIds === undefined ? eligible.map(loan => loan.id) : this.bookIds(body.loanIds);
      if (!ids.length || ids.some(id => !eligible.some(loan => loan.id === id))) throw new ConflictException('所选图书状态已变化，请刷新');
      if (body.declineRest !== undefined && (body.declineRest !== true || action !== 'approve')) throw new BadRequestException('部分同意操作不正确');
      for (const id of ids.sort()) await this.actInTransaction(tx, familyId, id, body);
      if (body.declineRest === true) for (const loan of eligible.filter(loan => !ids.includes(loan.id))) await this.actInTransaction(tx, familyId, loan.id, { action: 'decline' });
      return { ok: true, count: ids.length };
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
    return this.$transaction(tx => this.actInTransaction(tx, familyId, loanId, body));
  }

  private async actInTransaction(tx: Prisma.TransactionClient, familyId: string, loanId: string, body: Record<string, unknown>) {
      const action = text(body.action, '操作', 30, true);
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
  }

  async getAdmin(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await this.adminSession.findUnique({ where: { tokenHash: digest(`admin:${token}`) }, include: { admin: true } });
    return session && session.expiresAt > new Date() && session.admin.active ? session.admin : null;
  }

  requireAdmin(admin: Awaited<ReturnType<LibraryService['getAdmin']>>) {
    if (!admin) throw new UnauthorizedException('请先以管理员身份登录');
    return admin;
  }

  async adminLogin(body: Record<string, unknown>) {
    const username = usernameValue(body.username);
    const password = passwordValue(body.password);
    const key = digest(`admin-login:${username}`);
    const throttle = await this.authThrottle.findUnique({ where: { identifierHash: key } });
    if (throttle?.blockedUntil && throttle.blockedUntil > new Date()) throw new UnauthorizedException('账号或密码不正确，请稍后重试');
    const admin = await this.adminAccount.findUnique({ where: { username } });
    if (!admin?.active || !await matchesPassword(password, admin.passwordHash)) {
      const now = new Date();
      const recent = throttle && now.getTime() - throttle.windowStart.getTime() < 15 * 60_000;
      const attempts = recent ? throttle.attempts + 1 : 1;
      await this.authThrottle.upsert({ where: { identifierHash: key }, create: { identifierHash: key, attempts, windowStart: now, blockedUntil: attempts >= 8 ? new Date(now.getTime() + 15 * 60_000) : null }, update: { attempts, windowStart: recent ? undefined : now, blockedUntil: attempts >= 8 ? new Date(now.getTime() + 15 * 60_000) : null } });
      throw new UnauthorizedException('账号或密码不正确');
    }
    await this.authThrottle.deleteMany({ where: { identifierHash: key } });
    const token = randomBytes(32).toString('hex');
    await this.adminSession.create({ data: { adminId: admin.id, tokenHash: digest(`admin:${token}`), expiresAt: new Date(Date.now() + 8 * 3600_000) } });
    return { token, admin: { id: admin.id, username: admin.username } };
  }

  async adminLogout(token?: string) {
    if (token && /^[a-f0-9]{64}$/.test(token)) await this.adminSession.deleteMany({ where: { tokenHash: digest(`admin:${token}`) } });
    return { ok: true };
  }

  async createOption(adminId: string, body: Record<string, unknown>) {
    const kind = body.kind;
    if (kind !== 'CATEGORY' && kind !== 'AGE' && kind !== 'CONDITION') throw new BadRequestException('选项类型不正确');
    const label = text(body.label, '选项名称', 30, true);
    if (await this.catalogOption.findUnique({ where: { kind_label: { kind, label } } })) throw new ConflictException('选项已存在');
    const last = await this.catalogOption.findFirst({ where: { kind }, orderBy: { sortOrder: 'desc' } });
    return this.$transaction(async tx => {
      const option = await tx.catalogOption.create({ data: { kind, label, sortOrder: (last?.sortOrder ?? 0) + 10 } });
      await tx.adminAuditEvent.create({ data: { adminId, action: 'OPTION_CREATE', targetId: option.id } });
      return option;
    });
  }

  async updateOption(adminId: string, id: string, body: Record<string, unknown>) {
    const current = await this.catalogOption.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('选项不存在');
    const label = body.label === undefined ? current.label : text(body.label, '选项名称', 30, true);
    const active = body.active === undefined ? current.active : body.active;
    if (typeof active !== 'boolean') throw new BadRequestException('启用状态不正确');
    const sortOrder = body.sortOrder === undefined ? current.sortOrder : body.sortOrder;
    if (!Number.isInteger(sortOrder) || Number(sortOrder) < 0 || Number(sortOrder) > 100_000) throw new BadRequestException('排序值不正确');
    if (!active && current.active && await this.catalogOption.count({ where: { kind: current.kind, active: true } }) <= 1) throw new ConflictException('每类至少保留一个可用选项');
    const duplicate = await this.catalogOption.findUnique({ where: { kind_label: { kind: current.kind, label } } });
    if (duplicate && duplicate.id !== id) throw new ConflictException('选项名称已存在');
    return this.$transaction(async tx => {
      const option = await tx.catalogOption.update({ where: { id }, data: { label, active, sortOrder: Number(sortOrder) } });
      await tx.adminAuditEvent.create({ data: { adminId, action: 'OPTION_UPDATE', targetId: id } });
      return option;
    });
  }

  async adminOverview() {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [users, activeUsers, recentUsers, books, loans, categories, recentLoans] = await Promise.all([
      this.family.count(), this.family.count({ where: { status: 'ACTIVE' } }),
      this.family.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.book.groupBy({ by: ['status'], _count: true }),
      this.loan.groupBy({ by: ['status'], _count: true }),
      this.catalogOption.findMany({ where: { kind: 'CATEGORY' }, select: { id: true, label: true, _count: { select: { booksByCategory: true } } } }),
      this.loan.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
    ]);
    const days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.now() - (29 - i) * 86400_000);
      const day = date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      return { day, users: 0, loans: 0 };
    });
    for (const row of recentUsers) { const day = row.createdAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); const item = days.find(entry => entry.day === day); if (item) item.users++; }
    for (const row of recentLoans) { const day = row.createdAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); const item = days.find(entry => entry.day === day); if (item) item.loans++; }
    return { users: { total: users, active: activeUsers, new30Days: recentUsers.length }, books: Object.fromEntries(books.map(row => [row.status, row._count])), loans: Object.fromEntries(loans.map(row => [row.status, row._count])), trend: days, categories: categories.map(row => ({ label: row.label, count: row._count.booksByCategory })) };
  }

  async adminUsers(pageValue: unknown) {
    const page = Math.max(1, Math.min(100_000, Number(pageValue) || 1));
    if (!Number.isInteger(page)) throw new BadRequestException('页码不正确');
    const [total, rows] = await Promise.all([
      this.family.count(),
      this.family.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20, include: { _count: { select: { books: true, borrowedLoans: true, ownedLoans: true } } } }),
    ]);
    return { total, page, users: rows.map(row => ({ id: row.id, username: row.username, email: decrypt(row.emailCiphertext), displayName: row.displayName, status: row.status, createdAt: row.createdAt.toISOString(), phoneMasked: row.phoneCiphertext ? `${decrypt(row.phoneCiphertext).slice(0, 3)}••••${decrypt(row.phoneCiphertext).slice(-4)}` : '', phoneVerified: false, books: row._count.books, borrowed: row._count.borrowedLoans, lent: row._count.ownedLoans })) };
  }

  async adminPhone(adminId: string, familyId: string) {
    const family = await this.family.findUnique({ where: { id: familyId }, select: { phoneCiphertext: true } });
    if (!family) throw new NotFoundException('用户不存在');
    await this.adminAuditEvent.create({ data: { adminId, action: 'PHONE_REVEAL', targetId: familyId } });
    return { phone: decrypt(family.phoneCiphertext), verified: false };
  }
}
