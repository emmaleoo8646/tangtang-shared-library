import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ForbiddenException } from '@nestjs/common';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json({ limit: '8mb' }));
  if (process.env.NODE_ENV === 'production' && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) throw new Error('AUTH_SECRET is required');
  const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    .concat((process.env.ADMIN_ORIGIN ?? '').split(',').filter(Boolean))
    .concat(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5174', 'http://127.0.0.1:5174']);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.use((req: { method: string; headers: { origin?: string; host?: string } }, _res: unknown, next: (error?: Error) => void) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return next(new ForbiddenException('来源不允许'));
    next();
  });
  await app.listen(Number(process.env.PORT ?? 3000), process.env.API_HOST ?? '0.0.0.0');
}
await bootstrap();
