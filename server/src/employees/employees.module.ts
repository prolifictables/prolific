import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Employee, EmployeeSchema } from './schemas/employee.schema';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Employee.name, schema: EmployeeSchema }]),
    UsersModule,
    RbacModule,
    BranchesModule,
  ],
  providers: [EmployeesService],
  controllers: [EmployeesController],
  exports: [MongooseModule, EmployeesService],
})
export class EmployeesModule {}
