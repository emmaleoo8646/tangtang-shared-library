import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { decodeCover, recognizeCover, summarizeBook } from './book-assist.js';

let validJpeg: string;

describe('book cover and MiniMax assistance', () => {
  const previousKey = process.env.AI_API_KEY;
  const previousModel = process.env.AI_MODEL;

  beforeEach(() => {
    process.env.AI_API_KEY = 'test-minimax-key';
    process.env.AI_MODEL = 'MiniMax-M3';
  });
  beforeAll(async () => { validJpeg = `data:image/jpeg;base64,${(await sharp({ create: { width: 600, height: 600, channels: 3, background: '#f5a485' } }).jpeg().toBuffer()).toString('base64')}`; });
  afterEach(() => {
    if (previousKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = previousModel;
    vi.unstubAllGlobals();
  });

  it('accepts small processed covers and rejects forged or oversized images', async () => {
    expect((await decodeCover(validJpeg)).mimeType).toBe('image/jpeg');
    await expect(decodeCover('data:image/jpeg;base64,SGVsbG8=')).rejects.toThrow(BadRequestException);
    const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await expect(decodeCover(`data:image/jpeg;base64,${tiny.toString('base64')}`)).resolves.toMatchObject({ mimeType: 'image/jpeg' });
    const tooWide = await sharp({ create: { width: 961, height: 200, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    await expect(decodeCover(`data:image/jpeg;base64,${tooWide.toString('base64')}`)).rejects.toThrow(BadRequestException);
    await expect(decodeCover(`data:image/jpeg;base64,${Buffer.alloc(600_001, 255).toString('base64')}`)).rejects.toThrow(BadRequestException);
  });

  it('reads only visible metadata from MiniMax vision output', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"title":"森林里的邮差","author":"小林","category":"故事"}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(recognizeCover(await decodeCover(validJpeg))).resolves.toEqual({ title: '森林里的邮差', author: '小林', category: '故事' });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.minimaxi.com/v1/chat/completions');
    const body = JSON.parse(request.body as string);
    expect(body.messages[0].content[1].image_url.url).toBe(validJpeg);
  });

  it('requires a web search before returning an AI introduction', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ output_text: '一本讲述森林友谊的童书，资料已核对。', output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', annotations: [{ type: 'url_citation', title: '图书资料', url: 'https://example.org/book' }] }] }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"nonChildren":false,"summary":"一本讲述森林友谊的童书。"}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(summarizeBook('森林里的邮差', '小林')).resolves.toEqual({ summary: '一本讲述森林友谊的童书。', sources: [{ title: '图书资料', url: 'https://example.org/book' }], nonChildren: false });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toEqual([{ type: 'web_search' }]);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.minimaxi.com/v1/chat/completions');
  });

  it('marks adult books while preserving their introduction and intended readers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ output_text: '本书面向职场人士，介绍管理与思考方法。', output: [{ type: 'web_search_call' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"nonChildren":true,"summary":"介绍"底层逻辑"等管理与思考方法，适合职场人士阅读。"}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await summarizeBook('管理方法', '某作者');
    expect(result.nonChildren).toBe(true);
    expect(result.summary).toBe('这本书不是面向儿童的图书。介绍"底层逻辑"等管理与思考方法，适合职场人士阅读。');
  });
});
