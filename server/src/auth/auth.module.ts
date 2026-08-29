import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Employee, EmployeeSchema } from '../employees/schemas/employee.schema';
import { Restaurant, RestaurantSchema } from '../restaurants/schemas/restaurant.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Employee.name, schema: EmployeeSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: Restaurant.name, schema: RestaurantSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
      signOptions: {
        issuer: process.env.JWT_ISSUER || 'prolific.pos',
        audience: process.env.JWT_AUDIENCE || 'prolific.clients',
        expiresIn: parseInt(process.env.JWT_ACCESS_TTL_SECONDS || '900', 10),
      },
    }),
    RbacModule,
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService, MongooseModule],
})
export class AuthModule {}
