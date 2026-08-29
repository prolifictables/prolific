import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TableSession, TableSessionSchema } from './schemas/table-session.schema';
import { TableSessionsService } from './table-sessions.service';
import { TableSessionsController } from './table-sessions.controller';

@Module({
  imports: [MongooseModule.forFeature([{ name: TableSession.name, schema: TableSessionSchema }])],
  providers: [TableSessionsService],
  controllers: [TableSessionsController],
  exports: [MongooseModule, TableSessionsService],
})
export class TableSessionsModule {}
