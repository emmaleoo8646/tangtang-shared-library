import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { LibraryService } from '../src/library.service.js';
if (process.env.TEST_DATABASE_URL)
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
type Account = { id: string; cookie: string };
type Row = {
  id: string;
  bookId: string;
  stage: string;
  dueAt: string | null;
  renewed: boolean;
};
integration('atomic same-shop batches and series', () => {
  let app: INestApplication,
    db: LibraryService,
    server: Parameters<typeof request>[0],
    owner: Account,
    borrower: Account,
    other: Account;
  const families: string[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer();
    db = app.get(LibraryService);
    async function account(nickname: string) {
      const username = `batch_${randomUUID().slice(0, 8)}`,
        email = `${username}@example.test`;
      const code = await request(server)
        .post('/api/auth/email-code')
        .send({ email, purpose: 'register' })
        .expect(201);
      const r = await request(server)
        .post('/api/auth/register')
        .send({
          username,
          email,
          password: 'test-password-123',
          phone: '13800138000',
          nickname,
          code: code.body.developmentCode,
        })
        .expect(201);
      families.push(r.body.id);
      return {
        id: r.body.id,
        cookie: r.headers['set-cookie'][0].split(';')[0],
      };
    }
    owner = await account('同名书屋');
    borrower = await account('借方');
    other = await account('同名书屋');
  });
  afterAll(async () => {
    await db.loan.deleteMany({ where: { ownerFamilyId: { in: families } } });
    await db.loanGroup.deleteMany({
      where: { ownerFamilyId: { in: families } },
    });
    await db.book.deleteMany({ where: { ownerFamilyId: { in: families } } });
    await db.family.deleteMany({ where: { id: { in: families } } });
    await app.close();
  });
  async function book(title: string, family = owner) {
    const r = await request(server)
      .post('/api/books')
      .set('Cookie', family.cookie)
      .send({
        title,
        category: '绘本',
        age: '3—6 岁',
        condition: '九成新',
        privacyConfirmed: true,
      })
      .expect(201);
    return r.body.id as string;
  }
  const apply = (bookIds: string[], family = borrower, key = randomUUID()) =>
    request(server)
      .post('/api/loan-groups')
      .set('Cookie', family.cookie)
      .send({
        bookIds,
        shopId: owner.id,
        idempotencyKey: key,
        message: '一起读',
      });
  const action = (id: string, family: Account, body: unknown) =>
    request(server)
      .post(`/api/loan-groups/${id}/action`)
      .set('Cookie', family.cookie)
      .send(body);
  async function loans(id: string) {
    const r = await request(server)
      .get('/api/loans')
      .set('Cookie', owner.cookie)
      .expect(200);
    return r.body.filter((l: { groupId: string }) => l.groupId === id) as Row[];
  }
  it('deduplicates simultaneous retries and refuses changed requests with the same key', async () => {
    const ids = await Promise.all([
        book('重试甲'),
        book('重试乙'),
        book('重试丙'),
      ]),
      key = randomUUID();
    const r = await Promise.all([
      apply(ids, borrower, key),
      apply([...ids].reverse(), borrower, key),
    ]);
    expect(r.map((v) => v.status)).toEqual([201, 201]);
    expect(r[0].body.id).toBe(r[1].body.id);
    expect(await loans(r[0].body.id)).toHaveLength(3);
    expect((await apply(ids.slice(0, 2), borrower, key)).status).toBe(409);
    await action(r[0].body.id, borrower, { action: 'cancel' }).expect(201);
    expect(
      (await loans(r[0].body.id)).every((l) => l.stage === 'CANCELLED'),
    ).toBe(true);
  });
  it('rolls back the losing overlapping batch and protects access', async () => {
    const common = await book('争抢'),
      a = await book('甲'),
      b = await book('乙');
    const r = await Promise.all([
      apply([a, common]),
      apply([b, common], other),
    ]);
    expect(r.map((v) => v.status).sort()).toEqual([201, 409]);
    const winner = r[0].status === 201 ? borrower : other,
      loser = winner === borrower ? other : borrower,
      win = r.find((v) => v.status === 201)!;
    expect(
      (
        await db.book.findUniqueOrThrow({
          where: { id: winner === borrower ? b : a },
        })
      ).status,
    ).toBe('AVAILABLE');
    expect(
      await db.loanGroup.count({
        where: { loans: { some: { bookId: common } } },
      }),
    ).toBe(1);
    await action(win.body.id, loser, {
      action: 'approve',
      place: '公共图书馆',
    }).expect(403);
    await action(win.body.id, winner, { action: 'cancel' }).expect(201);
  });
  it('rejects unavailable, mixed-household, duplicate and self-owned selections without reserving other books', async () => {
    const a = await book('可借'),
      b = await book('下架'),
      c = await book('其他', other);
    await request(server)
      .patch(`/api/books/${b}/status`)
      .set('Cookie', owner.cookie)
      .send({ status: 'OFF_SHELF' })
      .expect(200);
    const r = await apply([a, b]);
    expect(r.status).toBe(409);
    expect(r.body.unavailableIds).toEqual([b]);
    expect((await db.book.findUniqueOrThrow({ where: { id: a } })).status).toBe(
      'AVAILABLE',
    );
    expect((await apply([a, c])).status).toBe(400);
    expect((await apply([a, a])).status).toBe(400);
    expect((await apply([a], owner)).status).toBe(400);
  });
  it('partially approves, receives, renews and returns without losing per-book state', async () => {
    const books = await Promise.all([
      book('分次一'),
      book('分次二'),
      book('分次三'),
      book('不借'),
    ]);
    const applied = await apply(books);
    expect(applied.status).toBe(201);
    const id = applied.body.id,
      rows = await loans(id),
      approved = rows.filter((l) => l.bookId !== books[3]);
    await action(id, owner, {
      action: 'approve',
      loanIds: [approved[0].id, 'invalid'],
      place: '图书馆',
      declineRest: true,
    }).expect(409);
    expect((await loans(id)).every((l) => l.stage === 'REQUESTED')).toBe(true);
    await action(id, owner, {
      action: 'approve',
      loanIds: approved.map((l) => l.id),
      place: '社区图书馆',
      declineRest: true,
    }).expect(201);
    expect(
      (await db.book.findUniqueOrThrow({ where: { id: books[3] } })).status,
    ).toBe('AVAILABLE');
    await action(id, borrower, {
      action: 'confirm-lend',
      loanIds: [approved[0].id],
    }).expect(201);
    let latest = await loans(id);
    expect(latest.find((l) => l.id === approved[0].id)?.dueAt).toBeTruthy();
    expect(latest.find((l) => l.id === approved[1].id)?.dueAt).toBeNull();
    await action(id, borrower, { action: 'confirm-lend' }).expect(201);
    await action(id, borrower, {
      action: 'request-renew',
      loanIds: [approved[0].id],
    }).expect(201);
    await action(id, owner, { action: 'approve-renew' }).expect(201);
    expect((await loans(id)).filter((l) => l.renewed)).toHaveLength(1);
    await action(id, owner, {
      action: 'confirm-return',
      loanIds: [approved[0].id],
    }).expect(201);
    expect((await loans(id)).filter((l) => l.stage === 'LENT')).toHaveLength(2);
    await action(id, borrower, { action: 'cancel' }).expect(409);
    await action(id, owner, { action: 'confirm-return' }).expect(201);
    latest = await loans(id);
    expect(latest.filter((l) => l.stage === 'RETURNED')).toHaveLength(3);
    expect(latest.filter((l) => l.stage === 'REJECTED')).toHaveLength(1);
  });
  it('expires all pending books after 48 hours and releases them', async () => {
    const ids = [await book('超时一'), await book('超时二')],
      r = await apply(ids);
    expect(r.status).toBe(201);
    await db.loan.updateMany({
      where: { groupId: r.body.id },
      data: { requestedAt: new Date(Date.now() - 49 * 3600_000) },
    });
    expect((await loans(r.body.id)).every((l) => l.stage === 'EXPIRED')).toBe(
      true,
    );
    expect(
      await db.book.count({ where: { id: { in: ids }, status: 'AVAILABLE' } }),
    ).toBe(2);
  });
  it('serves complete public shops over 200 books and separates namesakes by ID', async () => {
    const a = await book('系列甲'),
      b = await book('系列乙'),
      c = await book('其他系列', other);
    const series = await request(server)
      .post('/api/series')
      .set('Cookie', owner.cookie)
      .send({ name: '同名系列', summary: '共同主题', bookIds: [a, b] })
      .expect(201);
    const second = await request(server)
      .post('/api/series')
      .set('Cookie', other.cookie)
      .send({ name: '同名系列', bookIds: [c] })
      .expect(201);
    expect(series.body.id).not.toBe(second.body.id);
    await request(server)
      .post('/api/series')
      .set('Cookie', borrower.cookie)
      .send({ name: '越权', bookIds: [a] })
      .expect(403);
    const detail = await request(server).get(`/api/books/${a}`).expect(200);
    expect(detail.body.series).toMatchObject({
      id: series.body.id,
      name: '同名系列',
    });
    expect(detail.body.shopId).toBe(owner.id);
    const template = await db.book.findUniqueOrThrow({ where: { id: a } });
    await db.book.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        ownerFamilyId: owner.id,
        title: `分页${i}`,
        categoryOptionId: template.categoryOptionId,
        ageOptionId: template.ageOptionId,
        conditionOptionId: template.conditionOptionId,
        status: 'AVAILABLE',
      })),
    });
    const first = await request(server)
        .get(`/api/shops/${owner.id}/books?page=1&pageSize=200`)
        .expect(200),
      next = await request(server)
        .get(`/api/shops/${owner.id}/books?page=2&pageSize=200`)
        .expect(200);
    expect(first.body.total).toBeGreaterThan(200);
    expect(first.body.items).toHaveLength(200);
    const collected = [...first.body.items, ...next.body.items];
    expect(new Set(collected.map((b: { id: string }) => b.id)).size).toBe(
      first.body.total,
    );
    expect(collected.some((b: { offShelf: boolean }) => b.offShelf)).toBe(
      false,
    );
    const shop = await request(server)
      .get(`/api/shops/${owner.id}`)
      .expect(200);
    expect(Object.keys(shop.body).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
    await request(server)
      .get(`/api/shops/${owner.id}/books?page=0`)
      .expect(400);
    await request(server)
      .patch(`/api/books/${a}`)
      .set('Cookie', owner.cookie)
      .send({
        title: '系列甲',
        category: '绘本',
        age: '3—6 岁',
        condition: '九成新',
        seriesId: second.body.id,
      })
      .expect(400);
  });
});
