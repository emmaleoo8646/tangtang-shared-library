import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ForbiddenException } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  if (process.env.NODE_ENV === 'production' && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) throw new Error('AUTH_SECRET is required');
  const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.use((req: { method: string; headers: { origin?: string; host?: string } }, _res: unknown, next: (error?: Error) => void) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return next(new ForbiddenException('来源不允许'));
    next();
  });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
await bootstrap();
