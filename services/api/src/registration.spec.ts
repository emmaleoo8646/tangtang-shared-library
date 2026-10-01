import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { LibraryService } from './library.service.js';
import { requireEmailDelivery, sendAccountCode } from './email.js';

vi.mock('./email.js', () => ({ requireEmailDelivery: vi.fn(), sendAccountCode: vi.fn() }));

describe('public registration', () => {
  const secret = 'registration-test-secret-at-least-32-characters';
  const email = 'new-family@example.test';
  const account = { username: 'new_family', email, password: 'test-password-123' };

  function setup() {
    const emailCode = {
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const family = {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'family-id', ...data })),
    };
    const session = { create: vi.fn().mockResolvedValue({}) };
    const service = Object.assign(Object.create(LibraryService.prototype) as LibraryService, {
      emailCode, family, session,
      $transaction: vi.fn().mockImplementation(async work => work({ emailCode, family, session })),
    });
    return { service, emailCode, family, session };
  }

  function setCode(emailCode: ReturnType<typeof setup>['emailCode'], code = '123456', expiresAt = new Date(Date.now() + 60_000)) {
    const emailHash = createHmac('sha256', secret).update(`email:${email}`).digest('hex');
    const codeHash = createHmac('sha256', secret).update(`email-code:REGISTER:${emailHash}:${code}`).digest('hex');
    emailCode.findUnique.mockResolvedValue({ codeHash, expiresAt, attempts: 0 });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_SECRET', secret);
    vi.stubEnv('NODE_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['', 'approved@example.test'])('sends production codes without a test allowlist (%s)', async allowlist => {
    vi.stubEnv('TEST_EMAIL_ALLOWLIST', allowlist);
    const { service, emailCode } = setup();
    await expect(service.requestEmailCode({ email, purpose: 'register' })).resolves.toEqual({ sent: true });
    expect(requireEmailDelivery).toHaveBeenCalled();
    expect(sendAccountCode).toHaveBeenCalledWith(email, expect.stringMatching(/^\d{6}$/), 'REGISTER');
    expect(emailCode.upsert).toHaveBeenCalled();
  });

  it('registers without nickname or phone and creates an authenticated session', async () => {
    const { service, emailCode, family, session } = setup();
    setCode(emailCode);
    const result = await service.register({ ...account, code: '123456' });
    expect(result.family).toEqual({ id: 'family-id', displayName: account.username, avatarUrl: null });
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    const data = family.create.mock.calls[0][0].data;
    expect(data.phoneCiphertext).toBeNull();
    expect(data.emailCiphertext).not.toContain(email);
    expect(data.passwordHash).not.toContain(account.password);
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(session.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ familyId: 'family-id' }) }));
  });

  it.each(['000000', 'abcdef'])('rejects invalid email verification (%s)', async code => {
    const { service, emailCode, family, session } = setup();
    setCode(emailCode);
    await expect(service.register({ ...account, code })).rejects.toThrow(code === 'abcdef' ? BadRequestException : UnauthorizedException);
    expect(family.create).not.toHaveBeenCalled();
    expect(session.create).not.toHaveBeenCalled();
  });

  it('rejects expired or already consumed codes', async () => {
    const { service, emailCode, family } = setup();
    setCode(emailCode, '123456', new Date(Date.now() - 1));
    await expect(service.register({ ...account, code: '123456' })).rejects.toThrow(UnauthorizedException);
    setCode(emailCode);
    emailCode.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.register({ ...account, code: '123456' })).rejects.toThrow(UnauthorizedException);
    expect(family.create).not.toHaveBeenCalled();
  });

  it('keeps duplicate-email protection and email send limits', async () => {
    const { service, emailCode, family } = setup();
    family.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service.requestEmailCode({ email, purpose: 'register' })).rejects.toThrow(ConflictException);
    family.findUnique.mockResolvedValue(null);
    emailCode.count.mockResolvedValue(100);
    await expect(service.requestEmailCode({ email, purpose: 'register' })).rejects.toThrow('邮件服务繁忙');
    expect(sendAccountCode).not.toHaveBeenCalled();
  });

  it('still accepts valid profile fields from existing clients', async () => {
    const { service, emailCode, family } = setup();
    setCode(emailCode);
    const result = await service.register({ ...account, code: '123456', nickname: '森林书屋', phone: '13800138000' });
    expect(result.family.displayName).toBe('森林书屋');
    expect(family.create.mock.calls[0][0].data.phoneCiphertext).not.toContain('13800138000');
    await expect(service.register({ ...account, code: '123456', phone: 'invalid' })).rejects.toThrow(BadRequestException);
  });
});
