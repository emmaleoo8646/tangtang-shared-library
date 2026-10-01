import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

export type ProcessedImage = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: Buffer };

export async function decodeImage(value: unknown, label = '封面', square = false): Promise<ProcessedImage> {
  if (typeof value !== 'string') throw new BadRequestException(`请上传${label}照片`);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > 800_000) throw new BadRequestException(`${label}只支持 JPG、PNG、WebP，处理后不能超过 600 KB`);
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > 600_000) throw new BadRequestException(`处理后的${label}不能超过 600 KB`);
  const mimeType = match[1] as ProcessedImage['mimeType'];
  const valid = mimeType === 'image/jpeg' ? data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : mimeType === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw new BadRequestException(`${label}图片格式不正确`);
  try {
    const image = sharp(data, { limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== mimeType.slice(6) || !metadata.width || !metadata.height || metadata.width > 960 || metadata.height > 960) {
      throw new BadRequestException(`请裁剪${label}，使图片最长边不超过 960 像素`);
    }
    if (square && metadata.width !== metadata.height) throw new BadRequestException('请将头像裁剪为正方形');
    await image.raw().toBuffer();
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(`${label}图片无法读取，请使用 JPG、PNG 或 WebP`);
  }
  return { mimeType, data };
}
