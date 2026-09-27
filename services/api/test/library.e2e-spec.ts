import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration('two-family borrowing flow', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const seed = String(Date.now()).slice(-8);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => { await app.close(); });

  async function signIn(suffix: number, nickname: string) {
    const username = `family_${seed}_${suffix}`;
    const email = `${username}@example.test`;
    const password = `test-password-${seed}`;
    const sent = await request(server).post('/api/auth/email-code').send({ email, purpose: 'register' }).expect(201);
    const verified = await request(server).post('/api/auth/register').send({ username, email, password, code: sent.body.developmentCode, nickname }).expect(201);
    return { cookie: verified.headers['set-cookie'][0].split(';')[0] as string, id: verified.body.id as string, username, email, password };
  }

  it('verifies registration email and restores access after a password reset', async () => {
    const username = `recovery_${seed}`;
    const email = `${username}@example.test`;
    const sent = await request(server).post('/api/auth/email-code').send({ email, purpose: 'register' }).expect(201);
    await request(server).post('/api/auth/register').send({ username, email, password: 'first-password-123', code: '000000' }).expect(401);
    const registered = await request(server).post('/api/auth/register').send({ username, email, password: 'first-password-123', code: sent.body.developmentCode }).expect(201);
    const firstCookie = registered.headers['set-cookie'][0].split(';')[0] as string;
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

  it('keeps one active claim, protects parties, and returns the book after both confirmations', async () => {
    const owner = await signIn(1, '测试书主');
    const borrower = await signIn(2, '测试借方');
    const outsider = await signIn(3, '测试第三方');
    const created = await request(server).post('/api/books').set('Cookie', owner.cookie).send({ title: '真实借阅测试书', author: '', category: '绘本', age: '3—6 岁', condition: '九成新', summary: '测试简介', privacyConfirmed: true }).expect(201);
    const bookId = created.body.id as string;
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
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', loser.cookie).send({ action: 'approve' }).expect(403);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'approve' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'set-place', place: '社区图书馆门口' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'confirm-lend' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'confirm-lend' }).expect(409);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-lend' }).expect(201);
    const lent = await request(server).get('/api/loans').set('Cookie', winner.cookie).expect(200);
    const loan = lent.body.find((item: { id: string }) => item.id === loanId);
    expect(loan.stage).toBe('LENT');
    expect(loan.place).toBe('社区图书馆门口');
    expect(loan.dueAt).toBeTruthy();
    await request(server).delete('/api/me').set('Cookie', owner.cookie).expect(409);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'request-renew' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'approve-renew' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', winner.cookie).send({ action: 'confirm-return' }).expect(201);
    await request(server).post(`/api/loans/${loanId}/action`).set('Cookie', owner.cookie).send({ action: 'confirm-return' }).expect(201);
    const returned = await request(server).get('/api/books').expect(200);
    expect(returned.body.find((book: { id: string }) => book.id === bookId).available).toBe(true);
    await request(server).delete('/api/me').set('Cookie', owner.cookie).expect(200);
    await request(server).get('/api/me').set('Cookie', owner.cookie).expect(401);
    const afterClose = await request(server).get('/api/books').expect(200);
    expect(afterClose.body.find((book: { id: string }) => book.id === bookId)).toBeUndefined();
  });
});
