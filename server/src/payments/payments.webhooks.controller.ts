import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as S from '@prolific/shared-types';
import { PaystackAdapter } from './adapters/paystack.adapter';
import { FlutterwaveAdapter } from './adapters/flutterwave.adapter';
import { PaymentsService } from './payments.service';
import { Payment } from './schemas/payment.schema';
import { Order } from '../orders/schemas/order.schema';
import { SocketGateway } from '../socket/socket.gateway';

interface PendingWebhook {
  provider: 'PAYSTACK' | 'FLUTTERWAVE';
  event: string;
  reference: string;
  amountCents?: number;
  receivedAt: Date;
  raw: any;
}

@Public()
@Controller({ path: 'payments', version: '1' })
export class PaymentsWebhooksController {
  private readonly logger = new Logger(PaymentsWebhooksController.name);
  private pendingWebhooks: PendingWebhook[] = [];

  constructor(
    private readonly paystackAdapter: PaystackAdapter,
    private readonly flutterwaveAdapter: FlutterwaveAdapter,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    private readonly socketGateway: SocketGateway
  ) {}

  @Post('webhook/paystack')
  @HttpCode(200)
  async handlePaystackWebhook(
    @Headers('x-paystack-signature') signatureHeader: string | undefined,
    @Headers('x-prolific-mock') mockHeader: string | undefined,
    @Req() req: any
  ): Promise<{ status: string }> {
    try {
      const rawBody = this.extractRawBody(req);
      const signature =
        mockHeader === '1' && process.env.NODE_ENV !== 'production'
          ? 'mock'
          : signatureHeader;
      const parsed = this.paystackAdapter.parseWebhook(rawBody, signature);

      if (!parsed.valid) {
        this.logger.warn('Paystack webhook: invalid signature or unparseable body');
        return { status: 'ok' };
      }

      this.logger.log(
        `Paystack webhook received: event=${parsed.event} ref=${parsed.reference}`
      );

      if (parsed.event === 'charge.success' && parsed.reference) {
        try {
          await this.processSuccessWebhook('PAYSTACK', parsed.reference, parsed.amountCents, parsed.raw);
        } catch (err) {
          this.logger.error(
            `Paystack webhook processing failed: ${(err as Error).message}`,
            (err as Error).stack
          );
        }
      }

      return { status: 'ok' };
    } catch (err) {
      this.logger.error(
        `Paystack webhook handler error (returning 200): ${(err as Error).message}`,
        (err as Error).stack
      );
      return { status: 'ok' };
    }
  }

  @Post('webhook/flutterwave')
  @HttpCode(200)
  async handleFlutterwaveWebhook(
    @Headers('verif-hash') signatureHeader: string | undefined,
    @Headers('x-prolific-mock') mockHeader: string | undefined,
    @Req() req: any
  ): Promise<{ status: string }> {
    try {
      const rawBody = this.extractRawBody(req);
      const signature =
        mockHeader === '1' && process.env.NODE_ENV !== 'production'
          ? 'mock'
          : signatureHeader;
      const parsed = this.flutterwaveAdapter.parseWebhook(rawBody, signature);

      if (!parsed.valid) {
        this.logger.warn('Flutterwave webhook: invalid signature or unparseable body');
        return { status: 'ok' };
      }

      this.logger.log(
        `Flutterwave webhook received: event=${parsed.event} ref=${parsed.reference}`
      );

      if (parsed.event === 'charge.completed' && parsed.reference) {
        try {
          await this.processSuccessWebhook('FLUTTERWAVE', parsed.reference, parsed.amountCents, parsed.raw);
        } catch (err) {
          this.logger.error(
            `Flutterwave webhook processing failed: ${(err as Error).message}`,
            (err as Error).stack
          );
        }
      }

      return { status: 'ok' };
    } catch (err) {
      this.logger.error(
        `Flutterwave webhook handler error (returning 200): ${(err as Error).message}`,
        (err as Error).stack
      );
      return { status: 'ok' };
    }
  }

  private extractRawBody(req: any): string {
    if (req.rawBody !== undefined && req.rawBody !== null) {
      return typeof req.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString('utf-8')
        : JSON.stringify(req.rawBody);
    }
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') return req.body;
      return JSON.stringify(req.body);
    }
    return '';
  }

  private async processSuccessWebhook(
    provider: 'PAYSTACK' | 'FLUTTERWAVE',
    reference: string,
    amountCents: number | undefined,
    raw: any
  ): Promise<void> {
    const payment = await this.paymentModel
      .findOne({
        provider,
        transactionReference: reference,
        status: { $in: [S.PaymentStatus.PENDING, S.PaymentStatus.PAID] },
      })
      .exec();

    if (!payment) {
      this.logger.warn(
        `Webhook: no pending payment found for provider=${provider} ref=${reference} — stashing for retry`
      );
      this.stashPendingWebhook({
        provider,
        event: provider === 'PAYSTACK' ? 'charge.success' : 'charge.completed',
        reference,
        amountCents,
        receivedAt: new Date(),
        raw,
      });
      return;
    }

    if (payment.status === S.PaymentStatus.PAID) {
      this.logger.log(
        `Webhook idempotent replay: payment ${payment._id} already PAID — no-op`
      );
      return;
    }

    try {
      await (this.paymentsService as any).completeOnlinePayment(
        provider,
        reference,
        raw
      );
    } catch (err) {
      this.logger.error(
        `completeOnlinePayment failed for ${provider} ref=${reference}: ${(err as Error).message}`,
        (err as Error).stack
      );
      throw err;
    }

    const order = await this.orderModel.findById(payment.orderId).exec();
    if (order) {
      this.socketGateway.broadcast(
        `branch:${order.branchId}`,
        'server:order:status',
        {
          orderId: order._id.toString(),
          status: order.status,
          paymentStatus: S.PaymentStatus.PAID,
          timestamp: new Date(),
        }
      );

      this.socketGateway.broadcast(
        `branch:${order.branchId}`,
        'server:order:payment:received',
        {
          orderId: order._id.toString(),
          paymentId: payment._id.toString(),
          amount: payment.amountCents,
          timestamp: new Date(),
        }
      );
    }
  }

  private stashPendingWebhook(wh: PendingWebhook): void {
    this.pendingWebhooks.push(wh);
    if (this.pendingWebhooks.length > 500) {
      this.pendingWebhooks = this.pendingWebhooks.slice(-250);
    }
  }
}
