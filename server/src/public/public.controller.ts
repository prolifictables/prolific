import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Logger,
  Res,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { PublicService } from './public.service';
import type { Response } from 'express';

interface JoinSessionBody {
  qrToken: string;
  displayName?: string;
  customerId?: string;
  phone?: string;
  email?: string;
}

interface SubmitOrderBody {
  qrToken: string;
  guestToken: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
    specialInstructions?: string;
    selectedModifierOptions: Array<{ modifierId: string; optionId: string }>;
  }>;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'PICKUP' | 'DELIVERY';
  displayName?: string;
  customerInfo?: { name?: string; phone?: string; email?: string };
  payIntent: 'PAY_AT_POS' | 'PAY_ONLINE';
  onlineProvider?: 'PAYSTACK' | 'FLUTTERWAVE';
}

interface SubmitWebsiteOrderBody {
  branchId: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
    specialInstructions?: string;
    selectedModifierOptions: Array<{ modifierId: string; optionId: string }>;
  }>;
  orderType: 'DINE_IN' | 'TAKEAWAY' | 'PICKUP' | 'DELIVERY';
  displayName?: string;
  customerInfo?: { name?: string; phone?: string; email?: string };
  payIntent: 'PAY_AT_POS' | 'PAY_ONLINE';
  onlineProvider?: 'PAYSTACK' | 'FLUTTERWAVE';
}

@Public()
@Controller({ path: 'public', version: '1' })
export class PublicController {
  private readonly logger = new Logger(PublicController.name);

  constructor(private readonly publicService: PublicService) {}

  @Get('qr/:token')
  async resolveQr(@Param('token') token: string) {
    return this.publicService.resolveQr(token);
  }

  // New resolve endpoint: accepts ?table=TABLE_ID (for /order?table=X QR URL format).
  // Validation flow is identical to resolveQr — server verifies TABLE_ID is an active
  // QR token linked to a real table before returning anything.
  @Get('table-resolve')
  async resolveTableByIdentifier(@Query('table') tableIdentifier: string) {
    if (!tableIdentifier) {
      throw new BadRequestException('table identifier query param is required');
    }
    return this.publicService.resolveQr(tableIdentifier);
  }

  @Get('menu')
  async getPublicMenu(
    @Query('branchId') branchId: string,
    @Query('categoryIds') categoryIds?: string
  ) {
    const withCategoryIds = categoryIds
      ? categoryIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    return this.publicService.getPublicMenu(branchId, { withCategoryIds });
  }

  @Get('branches')
  async listPublicBranches(
    @Query('restaurantId') restaurantId?: string,
    @Query('name') nameQuery?: string
  ) {
    return this.publicService.listBranches({ restaurantId, nameQuery });
  }

  @Post('table-sessions/join')
  async joinOrStartTableSession(@Body() body: JoinSessionBody) {
    const { qrToken, displayName, customerId, phone, email } = body;
    return this.publicService.joinOrStartTableSession(qrToken, {
      displayName,
      customerId,
      phone,
      email,
    });
  }

  @Post('table-sessions/:sessionId/orders')
  async submitOrderFromTable(
    @Param('sessionId') sessionId: string,
    @Body() body: SubmitOrderBody
  ) {
    const { qrToken, guestToken, ...input } = body;
    return this.publicService.submitOrderFromTable(
      qrToken,
      sessionId,
      guestToken,
      input
    );
  }

  @Post('orders')
  async submitWebsiteOrder(@Body() body: SubmitWebsiteOrderBody) {
    const { branchId, ...input } = body;
    return this.publicService.submitOrderFromWebsite(branchId, input);
  }

  @Get('payments/callback')
  async handlePaymentCallback(
    @Query('orderId') orderId: string,
    @Query('token') token: string | undefined,
    @Query('mode') mode: string | undefined,
    @Query() query: Record<string, string | string[] | undefined>,
    @Res() res: Response
  ) {
    const appBase = String(process.env.APP_URL || 'http://localhost:3001').replace(/\/+$/, '');
    const targetPath =
      token && token !== 'DEMO'
        ? `/t/${encodeURIComponent(token)}/orders/${encodeURIComponent(orderId)}`
        : `/orders/${encodeURIComponent(orderId)}`;

    const url = new URL(appBase + targetPath);
    for (const [k, v] of Object.entries(query)) {
      if (k === 'orderId' || k === 'token' || k === 'mode') continue;
      if (typeof v === 'string') url.searchParams.set(k, v);
    }
    if (!url.searchParams.has('ref')) {
      const ref =
        (typeof query.reference === 'string' && query.reference) ||
        (typeof query.tx_ref === 'string' && query.tx_ref) ||
        (typeof query.flw_ref === 'string' && query.flw_ref) ||
        null;
      if (ref) url.searchParams.set('ref', ref);
    }
    if (!url.searchParams.has('status') && typeof query.status === 'string') {
      const raw = String(query.status).toLowerCase();
      if (raw.includes('success')) url.searchParams.set('status', 'success');
      if (raw.includes('fail') || raw.includes('cancel')) url.searchParams.set('status', 'failed');
    }
    if (mode && !url.searchParams.has('mode')) {
      url.searchParams.set('mode', mode);
    }
    return res.redirect(url.toString());
  }

  @Get('table-sessions/:sessionId/status')
  async getTableSessionStatus(@Param('sessionId') sessionId: string) {
    return this.publicService.getTableSessionStatus(sessionId);
  }

  @Get('orders/:id')
  async getPublicOrderStatus(@Param('id') id: string) {
    return this.publicService.getPublicOrderStatus(id);
  }

  @Get('recent-orders')
  async listRecentPosExternalOrders(
    @Query('branchId') branchId?: string,
    @Query('sinceHours') sinceHours?: string
  ) {
    return this.publicService.listRecentPosExternalOrders({
      branchId,
      sinceHours: sinceHours ? Number(sinceHours) : undefined,
    });
  }

  // POS-originated sync batch endpoint (no JWT — browser mock shim pushes here)
  // Accepts ORDER UPDATE (payment/status) + PAYMENT CREATE commands exactly like
  // /sync/batch, but bypasses JWT guard since browser POS has no auth token.
  @Post('pos-sync-batch')
  async applyPosSyncBatch(
    @Body()
    body: {
      deviceId?: string;
      commands: Array<{
        idempotencyKey: string;
        entityType: string;
        operation: 'CREATE' | 'UPDATE' | 'DELETE';
        entityId?: string;
        payload: Record<string, unknown>;
        localEntityVersion?: number;
      }>;
    }
  ) {
    return this.publicService.applyPosSyncBatch({
      deviceId: body.deviceId,
      commands: Array.isArray(body.commands) ? body.commands : [],
    });
  }

  // Unauthenticated read of the admin-managed customer-display write-up for a
  // branch. The POS customer-display popup calls this on bootstrap so that any
  // promos, specials, or branding text edits show up without a code deploy.
  // Returns {} when nothing is saved yet — client falls back to hardcoded defaults.
  @Get('customer-display-settings')
  async getCustomerDisplaySettings(@Query('branchId') branchId: string | undefined) {
    return this.publicService.getCustomerDisplaySettings({ branchId });
  }
}
