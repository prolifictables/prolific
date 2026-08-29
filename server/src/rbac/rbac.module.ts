import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RoleDefinition,
  RoleDefinitionSchema,
} from './schemas/role.schema';
import { RbacService } from './rbac.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: RoleDefinition.name, schema: RoleDefinitionSchema },
    ]),
  ],
  providers: [RbacService],
  exports: [RbacService, MongooseModule],
})
export class RbacModule {}

