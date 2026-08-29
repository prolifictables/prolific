import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { TablesModule } from '../tables/tables.module';
import { UsersModule } from '../users/users.module';
import { PosController } from './pos.controller';

@Module({
  imports: [EmployeesModule, TablesModule, UsersModule],
  controllers: [PosController],
})
export class PosModule {}
