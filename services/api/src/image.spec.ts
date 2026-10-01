import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { decodeImage } from './image.js';

async function picture(format: 'jpeg' | 'png' | 'webp', width = 960, height = width) {
  const data = await sharp({ create: { width, height, channels: 3, background: '#e5aa81' } })[format]().toBuffer();
  return `data:image/${format};base64,${data.toString('base64')}`;
}

describe('processed avatar validation', () => {
  it('accepts valid square JPEG, PNG and WebP at the maximum dimension', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      expect((await decodeImage(await picture(format), '头像', true)).mimeType).toBe(`image/${format}`);
    }
  });

  it('rejects rectangular avatars without changing the cover aspect policy', async () => {
    const image = await picture('jpeg', 600, 400);
    await expect(decodeImage(image, '头像', true)).rejects.toThrow('正方形');
    await expect(decodeImage(image)).resolves.toMatchObject({ mimeType: 'image/jpeg' });
  });

  it('rejects invalid, forged, corrupt, oversized and over-dimension images', async () => {
    for (const invalid of [undefined, null, '', 'https://example.test/photo.jpg',
      'data:image/gif;base64,R0lGODlh', 'data:image/jpeg;base64,SGVsbG8=',
      'data:image/jpeg;base64,/9j/', await picture('jpeg', 961),
      `data:image/jpeg;base64,${Buffer.alloc(600_001, 255).toString('base64')}`,
      (await picture('png')).replace('image/png', 'image/jpeg'),
    ]) {
      await expect(decodeImage(invalid, '头像', true)).rejects.toThrow(BadRequestException);
    }
  });
});
