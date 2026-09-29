import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LibraryService } from './library.service.js';

function adminCookie(req: Request) {
  return req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('tt_admin_session='))?.slice('tt_admin_session='.length);
}

@Controller('api/admin')
export class AdminController {
  constructor(private readonly library: LibraryService) {}

  private async admin(req: Request) { return this.library.requireAdmin(await this.library.getAdmin(adminCookie(req))); }

  @Post('auth/login')
  async login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.library.adminLogin(body);
    res.cookie('tt_admin_session', result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/admin', maxAge: 8 * 3600_000 });
    return result.admin;
  }

  @Get('me')
  async me(@Req() req: Request) { const admin = await this.admin(req); return { id: admin.id, username: admin.username }; }

  @Post('auth/logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.library.adminLogout(adminCookie(req));
    res.clearCookie('tt_admin_session', { path: '/api/admin' });
    return { ok: true };
  }

  @Get('options')
  async options(@Req() req: Request) { await this.admin(req); return this.library.options(true); }

  @Post('options')
  async createOption(@Req() req: Request, @Body() body: Record<string, unknown>) { return this.library.createOption((await this.admin(req)).id, body); }

  @Patch('options/:id')
  async updateOption(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) { return this.library.updateOption((await this.admin(req)).id, id, body); }

  @Get('overview')
  async overview(@Req() req: Request) { await this.admin(req); return this.library.adminOverview(); }

  @Get('users')
  async users(@Req() req: Request, @Query('page') page: string) { await this.admin(req); return this.library.adminUsers(page); }

  @Get('users/:id/phone')
  async phone(@Req() req: Request, @Param('id') id: string) { return this.library.adminPhone((await this.admin(req)).id, id); }
}
