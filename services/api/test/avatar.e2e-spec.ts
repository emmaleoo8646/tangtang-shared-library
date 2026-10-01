import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { json } from 'express';
import { AppModule } from '../src/app.module.js';
import { LibraryService } from '../src/library.service.js';

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;

integration('family avatars', () => {
  let app: INestApplication;
  let server: Parameters<typeof request>[0];
  const seed = String(Date.now()).slice(-8);
  async function signIn(suffix: string) {
    const username = `avatar_${seed}_${suffix}`;
    const email = `${username}@example.test`;
    const sent = await request(server).post('/api/auth/email-code').send({ email, purpose: 'register' }).expect(201);
    const registered = await request(server).post('/api/auth/register').send({ username, email,
      password: 'avatar-test-password-123', code: sent.body.developmentCode }).expect(201);
    return { id: registered.body.id as string, cookie: registered.headers['set-cookie'][0].split(';')[0] as string, username };
  }
  async function image(width = 600, height = width, background = '#eaab86') {
    return `data:image/jpeg;base64,${(await sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer()).toString('base64')}`;
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(json({ limit: '8mb' }));
    await app.init(); server = app.getHttpServer();
  });
  afterAll(async () => { await app.close(); });

  it('persists, versions, publishes and removes avatars across profile, books and loans', async () => {
    const owner = await signIn('owner'), borrower = await signIn('borrower');
    const avatarImage = await image();
    const saved = await request(server).patch('/api/me').set('Cookie', owner.cookie)
      .send({ displayName: '头像书屋', avatarImage }).expect(200);
    const avatarUrl = saved.body.avatarUrl as string;
    expect(avatarUrl).toMatch(new RegExp(`^/api/shops/${owner.id}/avatar\\?v=`));
    expect(saved.body).not.toHaveProperty('avatarData');
    const photo = await request(server).get(avatarUrl).expect(200);
    expect(photo.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(Buffer.from(photo.body)).toEqual(Buffer.from(avatarImage.split(',')[1], 'base64'));
    await request(server).get('/api/me').set('Cookie', owner.cookie).expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBe(avatarUrl));
    await request(server).get(`/api/shops/${owner.id}`).expect(200)
      .expect(({ body }) => expect(body).toEqual({ id: owner.id, displayName: '头像书屋', avatarUrl }));
    const book = await request(server).post('/api/books').set('Cookie', owner.cookie).send({ title: '头像接口测试书',
      category: '绘本', age: '3—6 岁', condition: '九成新', privacyConfirmed: true }).expect(201);
    expect(book.body.ownerAvatarUrl).toBe(avatarUrl);
    await request(server).get(`/api/shops/${owner.id}/books`).expect(200)
      .expect(({ body }) => expect(body.items[0].ownerAvatarUrl).toBe(avatarUrl));
    const borrowerSaved = await request(server).patch('/api/me').set('Cookie', borrower.cookie)
      .send({ displayName: '借方头像', avatarImage: await image(300) }).expect(200);
    const loan = await request(server).post(`/api/books/${book.body.id}/apply`).set('Cookie', borrower.cookie).expect(201);
    for (const cookie of [owner.cookie, borrower.cookie]) {
      await request(server).get('/api/loans').set('Cookie', cookie).expect(200).expect(({ body }) => {
        expect(body.find((row: { id: string }) => row.id === loan.body.id)).toMatchObject({
          ownerAvatarUrl: avatarUrl, borrowerAvatarUrl: borrowerSaved.body.avatarUrl,
        });
      });
    }
    await request(server).patch('/api/me').set('Cookie', owner.cookie).send({ displayName: '只改昵称' }).expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBe(avatarUrl));
    const replaced = await request(server).patch('/api/me').set('Cookie', owner.cookie)
      .send({ displayName: '只改昵称', avatarImage: await image(400, 400, '#44775f') }).expect(200);
    expect(replaced.body.avatarUrl).not.toBe(avatarUrl);
    await request(server).post('/api/auth/login').send({ account: owner.username, password: 'avatar-test-password-123' }).expect(201)
      .expect(({ body }) => expect(body.avatarUrl).toBe(replaced.body.avatarUrl));
    await request(server).patch('/api/me').set('Cookie', owner.cookie).send({ displayName: '只改昵称', avatarImage: null }).expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBeNull());
    await request(server).get(replaced.body.avatarUrl).expect(404);
    await request(server).get(`/api/books/${book.body.id}`).expect(200)
      .expect(({ body }) => expect(body.ownerAvatarUrl).toBeNull());
  });

  it('rejects unauthenticated or invalid changes atomically and isolates family ownership', async () => {
    const owner = await signIn('valid'), other = await signIn('other');
    const saved = await request(server).patch('/api/me').set('Cookie', owner.cookie)
      .send({ displayName: '保留头像', avatarImage: await image() }).expect(200);
    await request(server).patch('/api/me').send({ displayName: '未登录', avatarImage: await image() }).expect(401);
    for (const avatarImage of [await image(600, 400), await image(961), '',
      'data:image/jpeg;base64,/9j/', 'data:image/gif;base64,R0lGODlh',
      `data:image/jpeg;base64,${Buffer.alloc(600_001).toString('base64')}`]) {
      await request(server).patch('/api/me').set('Cookie', owner.cookie).send({ displayName: '不应保存', avatarImage }).expect(400);
      await request(server).get('/api/me').set('Cookie', owner.cookie).expect(200).expect(({ body }) => {
        expect(body.displayName).toBe('保留头像'); expect(body.avatarUrl).toBe(saved.body.avatarUrl);
      });
    }
    await request(server).patch('/api/me').set('Cookie', other.cookie)
      .send({ id: owner.id, displayName: '另一家', avatarImage: await image(300) }).expect(200);
    await request(server).get('/api/me').set('Cookie', owner.cookie).expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBe(saved.body.avatarUrl));
  });

  it('returns null for older families and clears the photo on account closure', async () => {
    const owner = await signIn('closed');
    await request(server).get('/api/me').set('Cookie', owner.cookie).expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBeNull());
    await request(server).get(`/api/shops/${owner.id}/avatar`).expect(404);
    await request(server).get('/api/shops/nonexistent-avatar-family/avatar').expect(404);
    const saved = await request(server).patch('/api/me').set('Cookie', owner.cookie)
      .send({ displayName: '待注销', avatarImage: await image() }).expect(200);
    await request(server).delete('/api/me').set('Cookie', owner.cookie).expect(200);
    await request(server).get(saved.body.avatarUrl).expect(404);
    const stored = await app.get(LibraryService).family.findUniqueOrThrow({ where: { id: owner.id },
      select: { avatarData: true, avatarMimeType: true, avatarUpdatedAt: true } });
    expect(stored).toEqual({ avatarData: null, avatarMimeType: null, avatarUpdatedAt: null });
  });
});
