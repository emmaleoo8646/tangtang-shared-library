import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { LibraryService } from '../src/library.service.js';
import sharp from 'sharp';
import { json } from 'express';
import { randomBytes, scryptSync } from 'node:crypto';

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration('two-family borrowing flow', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const seed = String(Date.now()).slice(-8);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(json({ limit: '8mb' }));
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => { await app.close(); });

  async function signIn(suffix: number, nickname: string) {
    const username = `family_${seed}_${suffix}`;
    const email = `${username}@example.test`;
    const password = `test-password-${seed}`;
    const sent = await request(server).post('/api/auth/email-code').send({ email, purpose: 'register' }).expect(201);
    const verified = await request(server).post('/api/auth/register').send({ username, email, password, code: sent.body.developmentCode, nickname, phone: `1380013${String(suffix).padStart(4, '0')}` }).expect(201);
    return { cookie: verified.headers['set-cookie'][0].split(';')[0] as string, id: verified.body.id as string, username, email, password };
  }

  it('stores a cover photo and hides it after the owner takes the book off shelf', async () => {
    const owner = await signIn(8, '封面测试书屋');
    const coverImage = `data:image/jpeg;base64,${(await sharp({ create: { width: 600, height: 600, channels: 3, background: '#f3a379' } }).jpeg().toBuffer()).toString('base64')}`;
    const created = await request(server).post('/api/books').set('Cookie', owner.cookie).send({ title: '封面测试书', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '', coverImage, privacyConfirmed: true }).expect(201);
    const bookId = created.body.id as string;
    expect(created.body.coverUrl).toMatch(new RegExp(`^/api/books/${bookId}/cover\\?v=`));
    const photo = await request(server).get(`/api/books/${bookId}/cover`).expect(200);
    expect(photo.headers['content-type']).toContain('image/jpeg');
    const tooLarge = `data:image/jpeg;base64,${Buffer.alloc(600_001, 255).toString('base64')}`;
    await request(server).patch(`/api/books/${bookId}`).set('Cookie', owner.cookie).send({ title: '改名', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '', coverImage: tooLarge }).expect(400);
    const edited = await request(server).patch(`/api/books/${bookId}`).set('Cookie', owner.cookie).send({ title: '已编辑的封面测试书', author: '作者', category: '绘本', age: '3—6 岁', condition: '八成新', summary: '新简介', nonChildren: true }).expect(200);
    expect(edited.body).toMatchObject({ title: '已编辑的封面测试书', author: '作者', summary: '新简介', condition: '八成新', nonChildren: true });
    expect(edited.body.coverUrl).not.toBe(created.body.coverUrl);
    await request(server).patch(`/api/books/${bookId}/status`).set('Cookie', owner.cookie).send({ status: 'OFF_SHELF' }).expect(200);
    await request(server).get(`/api/books/${bookId}/cover`).expect(404);
    await request(server).get(`/api/books/${bookId}/cover`).set('Cookie', owner.cookie).expect(200);
  });

  it('verifies registration email and restores access after a password reset', async () => {
    const username = `recovery_${seed}`;
    const email = `${username}@example.test`;
    const sent = await request(server).post('/api/auth/email-code').send({ email, purpose: 'register' }).expect(201);
    await request(server).post('/api/auth/register').send({ username, email, password: 'first-password-123', phone: '13800139001', code: '000000' }).expect(401);
    const registered = await request(server).post('/api/auth/register').send({ username, email, password: 'first-password-123', phone: '13800139001', code: sent.body.developmentCode }).expect(201);
    const firstCookie = registered.headers['set-cookie'][0].split(';')[0] as string;
    const library = app.get(LibraryService);
    const stored = await library.family.findUniqueOrThrow({ where: { username } });
    expect(stored.phoneCiphertext).not.toContain('13800139001');
    await request(server).get('/api/me').set('Cookie', firstCookie).expect(200).expect(({ body }) => {
      expect(body).toMatchObject({ username, email });
    });
    await request(server).post('/api/auth/login').send({ account: username, password: 'wrong-password-123' }).expect(401);
    await request(server).post('/api/auth/login').send({ account: email, password: 'first-password-123' }).expect(201);
    const resetCode = await request(server).post('/api/auth/email-code').send({ email, purpose: 'reset' }).expect(201);
    await request(server).post('/api/auth/password-reset').send({ email, code: resetCode.body.developmentCode, password: 'second-password-123' }).expect(201);
    await request(server).get('/api/me').set('Cookie', firstCookie).expect(401);
    await request(server).post('/api/auth/login').send({ account: username, password: 'first-password-123' }).expect(401);
    await request(server).post('/api/auth/login').send({ account: username, password: 'second-password-123' }).expect(201);
    await request(server).post('/api/auth/password-reset').send({ email, code: resetCode.body.developmentCode, password: 'third-password-123' }).expect(401);
  });

  it('keeps old accounts without phone usable and lets them add one', async () => {
    const owner = await signIn(9, '旧账号');
    const library = app.get(LibraryService);
    await library.family.update({ where: { id: owner.id }, data: { phoneCiphertext: null } });
    const current = await request(server).get('/api/me').set('Cookie', owner.cookie).expect(200);
    expect(current.body.phone).toBe('');
    const saved = await request(server).patch('/api/me').set('Cookie', owner.cookie).send({ displayName: '旧账号', phone: '+8613900000001' }).expect(200);
    expect(saved.body.phone).toBe('+8613900000001');
    const stored = await library.family.findUniqueOrThrow({ where: { id: owner.id } });
    expect(stored.phoneCiphertext).not.toContain('13900000001');
  });

  it('protects the admin area and maintains shared options', async () => {
    const family = await signIn(10, '普通家庭');
    await request(server).get('/api/admin/overview').expect(401);
    await request(server).get('/api/admin/overview').set('Cookie', family.cookie).expect(401);
    await request(server).post('/api/admin/options').set('Cookie', family.cookie).send({ kind: 'CATEGORY', label: '越权分类' }).expect(401);
    const library = app.get(LibraryService);
    const adminUsername = `admin_${seed}`;
    const salt = randomBytes(16);
    const password = 'test-admin-password-123';
    const passwordHash = `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
    const admin = await library.adminAccount.create({ data: { username: adminUsername, passwordHash } });
    try {
      const login = await request(server).post('/api/admin/auth/login').send({ username: adminUsername, password }).expect(201);
      const cookie = login.headers['set-cookie'][0].split(';')[0] as string;
      const overview = await request(server).get('/api/admin/overview').set('Cookie', cookie).expect(200);
      expect(overview.body.users.total).toBeGreaterThan(0);
      const uniqueLabel = `测试年龄${seed}`;
      const created = await request(server).post('/api/admin/options').set('Cookie', cookie).send({ kind: 'AGE', label: uniqueLabel }).expect(201);
      const optionId = created.body.id as string;
      try {
        const publicOptions = await request(server).get('/api/options').expect(200);
        expect(publicOptions.body.ages.some((item: { id: string }) => item.id === optionId)).toBe(true);
        await request(server).patch(`/api/admin/options/${optionId}`).set('Cookie', cookie).send({ sortOrder: 1, label: `${uniqueLabel}新` }).expect(200);
        await request(server).patch(`/api/admin/options/${optionId}`).set('Cookie', cookie).send({ active: false }).expect(200);
        await request(server).patch(`/api/admin/options/${optionId}`).set('Cookie', cookie).send({ active: true }).expect(200);
        const listed = await request(server).get('/api/admin/users?page=1').set('Cookie', cookie).expect(200);
        expect(listed.body.users[0].phoneMasked).not.toBe('+8613800130010');
        const phone = await request(server).get(`/api/admin/users/${family.id}/phone`).set('Cookie', cookie).expect(200);
        expect(phone.body.verified).toBe(false);
      } finally { await library.catalogOption.delete({ where: { id: optionId } }); }
    } finally { await library.adminAuditEvent.deleteMany({ where: { adminId: admin.id } }); await library.adminSession.deleteMany({ where: { adminId: admin.id } }); await library.adminAccount.delete({ where: { id: admin.id } }); }
  });

  it('keeps one active claim and completes borrowing with the receiving parent confirming each handoff', async () => {
    const owner = await signIn(1, '测试书主');
    const borrower = await signIn(2, '测试借方');
    const outsider = await signIn(3, '测试第三方');
    const created = await request(server).post('/api/books').set('Cookie', owner.cookie).send({ title: '真实借阅测试书', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '测试简介', privacyConfirmed: true }).expect(201);
    const bookId = created.body.id as string;
    const bookEdit = { title: '非法改名', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '' };
    await request(server).patch(`/api/books/${bookId}`).set('Cookie', borrower.cookie).send(bookEdit).expect(404);
    const publicList = await request(server).get('/api/books').expect(200);
    expect(publicList.body.find((book: { id: string }) => book.id === bookId)).not.toHaveProperty('ownerFamilyId');

    const attempts = await Promise.all([
      request(server).post(`/api/books/${bookId}/apply`).set('Cookie', borrower.cookie),
      request(server).post(`/api/books/${bookId}/apply`).set('Cookie', outsider.cookie),
    ]);
    expect(attempts.map(result => result.status).sort()).toEqual([201, 409]);
    const winner = attempts[0].status === 201 ? borrower : outsider;
    const loser = attempts[0].status === 201 ? outsider : borrower;
    const loanId = (attempts.find(result => result.status === 201)!.body.id) as string;
    await request(server).patch(`/api/books/${bookId}`).set('Cookie', owner.cookie).send(bookEdit).expect(409);
    const pendingOwner = await request(server).get('/api/loans').set('Cookie', owner.cookie).expect(200);
    expect(pendingOwner.body.find((item: { id: string }) => item.id === loanId).contactPhone).toBeNull();
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', loser.cookie).send({ action: 'approve', place: '社区图书馆门口' }).expect(403);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'approve' }).expect(400);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'approve', place: '社区图书馆门口' }).expect(201);
    const approvedOwner = await request(server).get('/api/loans').set('Cookie', owner.cookie).expect(200);
    expect(approvedOwner.body.find((item: { id: string }) => item.id === loanId).contactPhone).toBeTruthy();
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-lend' }).expect(409);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'set-place', place: '家庭住址' }).expect(409);
    const agreedOwner = await request(server).get('/api/loans').set('Cookie', owner.cookie).expect(200);
    expect(agreedOwner.body.find((item: { id: string }) => item.id === loanId).contactPhone).toBeTruthy();
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'confirm-lend' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'confirm-lend' }).expect(409);
    const lent = await request(server).get('/api/loans').set('Cookie', winner.cookie).expect(200);
    const loan = lent.body.find((item: { id: string }) => item.id === loanId);
    expect(loan.stage).toBe('LENT');
    expect(loan.place).toBe('社区图书馆门口');
    expect(loan.dueAt).toBeTruthy();
    await request(server).delete('/api/me').set('Cookie', owner.cookie).expect(409);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'request-renew' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'approve-renew' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'confirm-return' }).expect(409);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'request-return' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'request-return' }).expect(409);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-return' }).expect(201);
    const closedOwner = await request(server).get('/api/loans').set('Cookie', owner.cookie).expect(200);
    expect(closedOwner.body.find((item: { id: string }) => item.id === loanId).contactPhone).toBeNull();
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-return' }).expect(409);
    const returned = await request(server).get('/api/books').expect(200);
    expect(returned.body.find((book: { id: string }) => book.id === bookId).available).toBe(true);
    await request(server).delete('/api/me').set('Cookie', owner.cookie).expect(200);
    await request(server).get('/api/me').set('Cookie', owner.cookie).expect(401);
    const afterClose = await request(server).get('/api/books').expect(200);
    expect(afterClose.body.find((book: { id: string }) => book.id === bookId)).toBeUndefined();
  });

  it('lets the owner finish a return without a borrower reminder', async () => {
    const owner = await signIn(4, '另一位书主');
    const borrower = await signIn(5, '另一位借方');
    const created = await request(server).post('/api/books').set('Cookie', owner.cookie).send({ title: '直接归还测试书', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '', privacyConfirmed: true }).expect(201);
    const bookId = created.body.id as string;
    const applied = await request(server).post(`/api/books/${bookId}/apply`).set('Cookie', borrower.cookie).expect(201);
    const loanId = applied.body.id as string;
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'approve', place: '社区图书馆门口' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', borrower.cookie).send({ action: 'confirm-lend' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-return' }).expect(201);
    const loans = await request(server).get('/api/loans').set('Cookie', borrower.cookie).expect(200);
    expect(loans.body.find((item: { id: string }) => item.id === loanId)).toMatchObject({ stage: 'RETURNED', borrowerReturnConfirmed: false, ownerReturnConfirmed: true });
    const books = await request(server).get('/api/books').expect(200);
    expect(books.body.find((book: { id: string }) => book.id === bookId).available).toBe(true);
  });

  it('finishes orders left halfway through the previous confirmation flow', async () => {
    const owner = await signIn(6, '旧订单书主');
    const borrower = await signIn(7, '旧订单借方');
    const created = await request(server).post('/api/books').set('Cookie', owner.cookie).send({ title: '旧订单测试书', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '', privacyConfirmed: true }).expect(201);
    const bookId = created.body.id as string;
    const applied = await request(server).post(`/api/books/${bookId}/apply`).set('Cookie', borrower.cookie).expect(201);
    const loanId = applied.body.id as string;
    const library = app.get(LibraryService);
    await library.loan.update({ where: { id: loanId }, data: { status: 'APPROVED', approvedAt: new Date() } });
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'set-place', place: '社区图书馆门口' }).expect(201);
    await library.loan.update({ where: { id: loanId }, data: { borrowerLentConfirmedAt: new Date() } });
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-lend' }).expect(201);
    await library.loan.update({ where: { id: loanId }, data: { status: 'RETURN_REQUESTED', ownerReturnConfirmedAt: new Date() } });
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-return' }).expect(201);
    const loans = await request(server).get('/api/loans').set('Cookie', owner.cookie).expect(200);
    expect(loans.body.find((item: { id: string }) => item.id === loanId).stage).toBe('RETURNED');
  });
});
