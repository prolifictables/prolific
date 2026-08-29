import { Controller, Get, Head, HttpCode } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @HttpCode(200)
  getHealth() {
    return { ok: true };
  }

  @Public()
  @Head()
  @HttpCode(200)
  headHealth() {
    return;
  }
}

