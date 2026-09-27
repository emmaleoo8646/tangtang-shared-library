import { ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

export function requireEmailDelivery() {
  if (process.env.NODE_ENV !== 'production') return;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM || ![465, 587].includes(port)) {
    throw new ServiceUnavailableException('邮件服务暂不可用');
  }
}

export async function sendAccountCode(to: string, code: string, purpose: 'REGISTER' | 'RESET') {
  if (process.env.NODE_ENV !== 'production') return;
  requireEmailDelivery();
  const port = Number(process.env.SMTP_PORT);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const subject = purpose === 'REGISTER' ? '糖糖共享书屋：验证邮箱' : '糖糖共享书屋：重置密码';
  const action = purpose === 'REGISTER' ? '注册' : '重置密码';
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: `你的${action}验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略本邮件。`,
  });
}
