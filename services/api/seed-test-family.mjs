import { PrismaClient } from '@prisma/client';
import { createCipheriv, createHash, randomBytes, scrypt } from 'node:crypto';

const AUTH_SECRET_FALLBACK = 'local-development-secret-change-before-production';
function secret() {
  const value = process.env.AUTH_SECRET ?? AUTH_SECRET_FALLBACK;
  return value;
}
function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret()).digest(), iv);
  const encoded = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encoded]).toString('base64');
}
function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}
async function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await derivePassword(password, salt)).toString('hex')}`;
}
function lookupHash(value) {
  return createHash('sha256').update(value.toLowerCase()).digest('hex');
}

const prisma = new PrismaClient();
const USERNAME = 'tangtang_demo';
const PASSWORD = 'Demo@2026!!';
const EMAIL = 'tangtang-demo@example.com';
const PHONE = '13800000001';
const NICKNAME = '糖糖演示书屋';

(async () => {
  try {
    const existing = await prisma.family.findFirst({ where: { username: USERNAME }, select: { id: true } });
    if (existing) {
      console.log('Account already exists, id=' + existing.id);
      await prisma.$disconnect();
      return;
    }
    const emailLookup = lookupHash(EMAIL);
    const phoneLookup = lookupHash(PHONE);
    const passwordHash = await hashPassword(PASSWORD);
    const emailCiphertext = encrypt(EMAIL);
    const phoneCiphertext = encrypt(PHONE);
    const created = await prisma.family.create({
      data: {
        username: USERNAME,
        displayName: NICKNAME,
        emailLookupHash: emailLookup,
        emailCiphertext,
        phoneLookupHash: phoneLookup,
        phoneCiphertext,
        emailVerifiedAt: new Date(),
        passwordHash,
        status: 'ACTIVE',
      },
    });
    console.log('Created family id:', created.id);
    console.log('username:', USERNAME);
    console.log('password:', PASSWORD);
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
})();
