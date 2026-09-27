import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LibraryService } from './library.service.js';

function cookie(req: Request) {
  return req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('tt_session='))?.slice('tt_session='.length);
}

@Controller('api')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  private async family(req: Request) {
    return this.library.requireFamily(await this.library.getFamily(cookie(req)));
  }

  @Post('auth/email-code')
  requestEmailCode(@Body() body: Record<string, unknown>) { return this.library.requestEmailCode(body); }

  @Post('auth/register')
  async register(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.library.register(body);
    res.cookie('tt_session', result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 30 * 24 * 3600_000 });
    return result.family;
  }

  @Post('auth/login')
  async login(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.library.login(body);
    res.cookie('tt_session', result.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 30 * 24 * 3600_000 });
    return result.family;
  }

  @Post('auth/password-reset')
  resetPassword(@Body() body: Record<string, unknown>) { return this.library.resetPassword(body); }

  @Post('auth/logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.library.logout(cookie(req));
    res.clearCookie('tt_session', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) { return this.library.me((await this.family(req)).id); }

  @Patch('me')
  async updateMe(@Req() req: Request, @Body() body: Record<string, unknown>) { return this.library.updateMe((await this.family(req)).id, body); }

  @Post('me/children')
  async addChild(@Req() req: Request, @Body() body: Record<string, unknown>) { return this.library.addChild((await this.family(req)).id, body); }

  @Delete('me/children/:id')
  async removeChild(@Req() req: Request, @Param('id') id: string) { return this.library.removeChild((await this.family(req)).id, id); }

  @Delete('me')
  async closeAccount(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.library.closeAccount((await this.family(req)).id);
    res.clearCookie('tt_session', { path: '/' });
    return result;
  }

  @Get('books')
  async books(@Req() req: Request) { return this.library.books((await this.library.getFamily(cookie(req)))?.id); }

  @Post('books')
  async createBook(@Req() req: Request, @Body() body: Record<string, unknown>) { return this.library.createBook((await this.family(req)).id, body); }

  @Patch('books/:id/status')
  async setBookStatus(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    if (body.status !== 'AVAILABLE' && body.status !== 'OFF_SHELF') throw new ForbiddenException('状态不正确');
    return this.library.setBookStatus((await this.family(req)).id, id, body.status);
  }

  @Get('loans')
  async loans(@Req() req: Request) { return this.library.loans((await this.family(req)).id); }

  @Post('books/:id/apply')
  async apply(@Req() req: Request, @Param('id') id: string) { return this.library.apply((await this.family(req)).id, id); }

  @Post('loans/:id/action')
  async act(@Req() req: Request, @Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.library.act((await this.family(req)).id, id, body);
  }
}
