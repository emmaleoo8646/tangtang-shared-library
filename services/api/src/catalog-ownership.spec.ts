import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';
import type { Request } from 'express';

describe('public shop viewer ownership', () => {
  it('passes the optional authenticated viewer to public shop books', async () => {
    const service = { getFamily: vi.fn().mockResolvedValue({ id: 'viewer' }), shopBooks: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new LibraryController(service as unknown as LibraryService);
    await controller.shopBooks({ headers: { cookie: 'tt_session=test-session' } } as Request, 'shop', { page: '1' });
    expect(service.getFamily).toHaveBeenCalledWith('test-session');
    expect(service.shopBooks).toHaveBeenCalledWith('shop', { page: '1' }, 'viewer');
  });

  it('keeps public browsing available to guests', async () => {
    const service = { getFamily: vi.fn().mockResolvedValue(null), shopBooks: vi.fn().mockResolvedValue({ items: [] }) };
    const controller = new LibraryController(service as unknown as LibraryService);
    await controller.shopBooks({ headers: {} } as Request, 'shop', {});
    expect(service.shopBooks).toHaveBeenCalledWith('shop', {}, undefined);
  });

  it('marks ownership without exposing family details or hidden books', async () => {
    const row = {
      id: 'book', ownerFamilyId: 'shop', ownerFamily: { displayName: '示例书屋' },
      title: '示例图书', status: 'AVAILABLE', series: null, seriesOrder: null,
      conditionOption: { label: '八成新' }, coverMimeType: null,
    };
    const service = Object.assign(Object.create(LibraryService.prototype) as LibraryService, {
      shop: vi.fn().mockResolvedValue({ id: 'shop' }), expireRequests: vi.fn().mockResolvedValue(undefined),
      book: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(1) },
    });
    const own = await service.shopBooks('shop', {}, 'shop');
    expect(own.items[0]).toMatchObject({ mine: true, editable: true, shopId: 'shop' });
    const other = await service.shopBooks('shop', {}, 'other');
    expect(other.items[0]).toMatchObject({ mine: false, editable: false });
    expect(service.book.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerFamilyId: 'shop', status: { notIn: ['DRAFT', 'OFF_SHELF'] } },
    }));
    expect(own.items[0]).not.toHaveProperty('ownerFamily');
  });
});
