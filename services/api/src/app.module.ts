import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { LibraryController } from './library.controller.js';
import { LibraryService } from './library.service.js';

@Module({
  imports: [],
  controllers: [AppController, LibraryController],
  providers: [AppService, LibraryService],
})
export class AppModule {}
