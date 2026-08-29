import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CustomersService, CreateCustomerInput } from './customers.service';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /**
   * List all customers within the current restaurant/branch tenant scope.
   */
  @Get()
  @HttpCode(200)
  async list(@CurrentUser() user: AuthContext) {
    return this.customersService.list(user);
  }

  /**
   * Get a single customer by id.
   */
  @Get(':id')
  @HttpCode(200)
  async get(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return this.customersService.findById(user, id);
  }

  /**
   * Create a new customer record.
   */
  @Post()
  @HttpCode(201)
  async create(
    @Body() body: CreateCustomerInput,
    @CurrentUser() user: AuthContext
  ) {
    return this.customersService.createCustomer(user, body);
  }

  /**
   * Update an existing customer's mutable fields.
   */
  @Patch(':id')
  @HttpCode(200)
  async update(
    @Param('id') id: string,
    @Body() body: Partial<CreateCustomerInput>,
    @CurrentUser() user: AuthContext
  ) {
    return this.customersService.update(user, id, body);
  }
}
