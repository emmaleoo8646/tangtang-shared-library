import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException,
} from '@nestjs/common';
import { BookCondition, BookStatus, Prisma, PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import Dysmsapi20170525, * as SmsApi from '@alicloud/dysmsapi20170525';
import * as OpenApiTypes from '@alicloud/openapi-client';
import Credential from '@alicloud/credentials';

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
    return session && session.expiresAt > new Date() ? session.family : null;
  }

  private sessionModelFind(tokenHash: string) {
    return this.session.findUnique({ where: { tokenHash }, include: { family: true } });
  }

  requireFamily(family: Awaited<ReturnType<LibraryService['getFamily']>>) {
    if (!family) throw new UnauthorizedException('请先登录');
    if (family.status !== 'ACTIVE') throw new ForbiddenException('账号不可用');
    return family;
  }

  async requestCode(body: Record<string, unknown>) {
    const phone = text(body.phone, '手机号', 11, true);
    if (!/^1[3-9]\d{9}$/.test(phone)) throw new BadRequestException('请输入中国内地手机号');
    const allowlist = process.env.TEST_PHONE_ALLOWLIST?.split(',').map(value => value.trim()).filter(Boolean);
    if (allowlist?.length && !allowlist.includes(phone)) throw new ForbiddenException('测试站暂未开放注册');
    const phoneHash = digest(`phone:${phone}`);
    const existing = await this.loginCode.findUnique({ where: { phoneHash } });
    const now = new Date();
    const recent = existing && now.getTime() - existing.windowStart.getTime() < 3600_000;
    if (existing && now.getTime() - existing.sentAt.getTime() < 60_000) throw new ConflictException('请一分钟后再试');
    if (recent && existing.sendCount >= 5) throw new ConflictException('发送次数过多，请稍后再试');
    if (process.env.NODE_ENV === 'production' && await this.loginCode.count({ where: { sentAt: { gt: new Date(now.getTime() - 3600_000) } } }) >= 20) throw new ConflictException('短信服务繁忙，请稍后再试');
    const code = String(randomInt(100000, 1000000));
    const codeHash = digest(`code:${phoneHash}:${code}`);
    if (process.env.NODE_ENV === 'production') {
      // Production must never disclose codes through the API or logs.
      await this.sendSms(phone, code);
    }
    await this.loginCode.upsert({ where: { phoneHash }, create: { phoneHash, codeHash, expiresAt: new Date(Date.now() + 5 * 60_000) }, update: { codeHash, expiresAt: new Date(Date.now() + 5 * 60_000), attempts: 0, sentAt: now, sendCount: recent ? { increment: 1 } : 1, windowStart: recent ? undefined : now } });
    return process.env.NODE_ENV === 'production' ? { sent: true } : { sent: true, developmentCode: code };
  }

  private async sendSms(phone: string, code: string) {
    const signName = process.env.ALIYUN_SMS_SIGN_NAME;
    const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE;
    if (!signName || !templateCode) throw new Error('ALIYUN_SMS_SIGN_NAME and ALIYUN_SMS_TEMPLATE_CODE are required');
    const client = new Dysmsapi20170525.default(new OpenApiTypes.Config({ credential: new Credential.default(), endpoint: 'dysmsapi.aliyuncs.com' }));
    const response = await client.sendSms(new SmsApi.SendSmsRequest({ phoneNumbers: phone, signName, templateCode, templateParam: JSON.stringify({ code }) }));
    if (response.body?.code !== 'OK') throw new Error('短信发送失败');
  }

  async verifyCode(body: Record<string, unknown>) {
    const phone = text(body.phone, '手机号', 11, true);
    const code = text(body.code, '验证码', 6, true);
    if (!/^1[3-9]\d{9}$/.test(phone) || !/^\d{6}$/.test(code)) throw new BadRequestException('手机号或验证码格式不正确');
    const phoneHash = digest(`phone:${phone}`);
    const record = await this.loginCode.findUnique({ where: { phoneHash } });
    if (!record || record.expiresAt < new Date() || record.attempts >= 5) throw new UnauthorizedException('验证码已失效');
    await this.loginCode.update({ where: { phoneHash }, data: { attempts: { increment: 1 } } });
    if (!same(record.codeHash, digest(`code:${phoneHash}:${code}`))) throw new UnauthorizedException('验证码不正确');
    const nickname = body.nickname === undefined ? '我的书屋' : text(body.nickname, '书屋昵称', 30, true);
    const token = randomBytes(32).toString('hex');
    const result = await this.$transaction(async tx => {
      await tx.loginCode.delete({ where: { phoneHash } });
      const family = await tx.family.upsert({ where: { phoneLookupHash: phoneHash }, create: { phoneLookupHash: phoneHash, displayName: nickname }, update: {} });
      await tx.session.create({ data: { familyId: family.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) } });
      return family;
    });
    return { token, family: { id: result.id, displayName: result.displayName } };
  }

  async logout(token?: string) {
    if (token && /^[a-f0-9]{64}$/.test(token)) await this.session.deleteMany({ where: { tokenHash: digest(token) } });
  }

  async me(familyId: string) {
    const family = await this.family.findUniqueOrThrow({ where: { id: familyId }, include: { children: true } });
    return { id: family.id, displayName: family.displayName, children: family.children.map(child => ({ id: child.id, nickname: child.nickname, age: ageLabel[child.ageBand] ?? '其他', readingPreferences: child.readingPreferences })) };
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
      await tx.family.update({ where: { id: familyId }, data: { status: 'CLOSED', phoneLookupHash: null, phoneCiphertext: null, displayName: '已注销书屋' } });
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
    return rows.map(row => ({ id: row.id, bookId: row.bookId, bookTitle: row.book.title, owner: row.ownerFamily.displayName, borrower: row.borrowerFamily.displayName, isOwner: row.ownerFamilyId === familyId, stage: row.status, place: decrypt(row.handoffDetailsCiphertext), borrowerLoanConfirmed: !!row.borrowerLentConfirmedAt, ownerLoanConfirmed: !!row.ownerLentConfirmedAt, borrowerReturnConfirmed: !!row.borrowerReturnConfirmedAt, ownerReturnConfirmed: !!row.ownerReturnConfirmedAt, renewalRequested: !!row.renewalRequestedAt, renewed: !!row.renewedAt, dueAt: row.dueAt?.toISOString() ?? null, requestedAt: row.requestedAt.toISOString() }));
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
      if (action === 'approve' && owner && expected === 'REQUESTED') data = { status: 'APPROVED', approvedAt: now };
      else if (action === 'decline' && owner && expected === 'REQUESTED') { data = { status: 'REJECTED' }; bookStatus = 'AVAILABLE'; }
      else if (action === 'cancel' && borrower && expected === 'REQUESTED') { data = { status: 'CANCELLED' }; bookStatus = 'AVAILABLE'; }
      else if (action === 'set-place' && (expected === 'APPROVED' || expected === 'HANDOFF_AGREED') && !loan.ownerLentConfirmedAt && !loan.borrowerLentConfirmedAt) {
        const place = text(body.place, '公共交接地点', 120, true);
        data = { handoffDetailsCiphertext: encrypt(place), status: 'HANDOFF_AGREED' };
      } else if (action === 'confirm-lend' && expected === 'HANDOFF_AGREED' && loan.handoffDetailsCiphertext) {
        if (owner && !loan.ownerLentConfirmedAt) data = { ownerLentConfirmedAt: now };
        if (borrower && !loan.borrowerLentConfirmedAt) data = { borrowerLentConfirmedAt: now };
        if ((owner && loan.borrowerLentConfirmedAt) || (borrower && loan.ownerLentConfirmedAt)) { data = { ...data, status: 'LENT', lentAt: now, dueAt: new Date(now.getTime() + 14 * 24 * 3600_000) }; bookStatus = 'ON_LOAN'; }
      } else if (action === 'confirm-return' && (expected === 'LENT' || expected === 'RETURN_REQUESTED')) {
        if (owner && !loan.ownerReturnConfirmedAt) data = { ownerReturnConfirmedAt: now };
        if (borrower && !loan.borrowerReturnConfirmedAt) data = { borrowerReturnConfirmedAt: now };
        if ((owner && loan.borrowerReturnConfirmedAt) || (borrower && loan.ownerReturnConfirmedAt)) { data = { ...data, status: 'RETURNED', returnedAt: now }; bookStatus = 'AVAILABLE'; }
        else if (Object.keys(data).length) data = { ...data, status: 'RETURN_REQUESTED' };
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
