import { Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import * as S from '@prolific/shared-types';
import { AuthContext } from '../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit/audit-logs.service';

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGIN?.split(',') ?? true) as string | boolean | string[],
    credentials: true,
  },
  namespace: '/',
})
export class SocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(SocketGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly auditLogsService: AuditLogsService
  ) {}

  afterInit(server: Server): void {
    this.logger.log('Socket.IO gateway initialized');
    void server;
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const rawToken =
        (socket.handshake.auth?.auth?.token as string | undefined) ||
        (socket.handshake.headers?.authorization as string | undefined);

      if (!rawToken) {
        this.logger.warn(`Socket ${socket.id} rejected: no token in handshake`);
        socket.disconnect(true);
        return;
      }

      const token = rawToken.startsWith('Bearer ')
        ? rawToken.slice(7)
        : rawToken;

      let payload: AuthContext;
      try {
        payload = (await this.jwtService.verifyAsync(token, {
          secret: process.env.JWT_ACCESS_SECRET,
          issuer: process.env.JWT_ISSUER,
          audience: process.env.JWT_AUDIENCE,
        })) as AuthContext;
      } catch (jwtErr) {
        this.logger.warn(
          `Socket ${socket.id} rejected: invalid JWT: ${(jwtErr as Error).message}`
        );
        socket.disconnect(true);
        return;
      }

      socket.data.ctx = payload;

      const rooms: string[] = [];
      if (payload.branchId) {
        rooms.push(`branch:${payload.branchId}`);
      }
      if (payload.restaurantId) {
        rooms.push(`restaurant:${payload.restaurantId}`);
      }

      const deviceId =
        (socket.handshake.headers['x-device-id'] as string | undefined) ||
        (socket.handshake.auth?.deviceId as string | undefined);
      if (deviceId) {
        rooms.push(`device:${deviceId}`);
      }

      if (payload.role) {
        rooms.push(`role:${payload.role}`);
      }

      const tableId =
        (socket.handshake.auth?.tableId as string | undefined) ||
        (socket.handshake.query?.tableId as string | undefined);
      if (tableId) {
        rooms.push(`table:${tableId}`);
      }

      const station = socket.handshake.auth?.station as string | undefined;
      if (station) {
        rooms.push(`kitchen-station:${station}`);
      }

      if (rooms.length > 0) {
        socket.join(rooms);
      }

      this.logger.log(
        `Socket connected: ${socket.id} | user=${payload.userId} role=${payload.role} branch=${payload.branchId ?? '-'} rooms=[${rooms.join(', ')}]`
      );
    } catch (err) {
      this.logger.error(
        `handleConnection error for socket ${socket.id}: ${(err as Error).message}`
      );
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    this.logger.log(
      `Socket disconnected: ${socket.id} | user=${ctx?.userId ?? 'unknown'} role=${ctx?.role ?? 'unknown'}`
    );
  }

  broadcast<T>(room: string, event: string, payload: T): void {
    this.server.to(room).emit(event, payload);
  }

  @SubscribeMessage('client:order:submit')
  async handleOrderSubmit(
    socket: Socket,
    data: Record<string, unknown>
  ): Promise<void> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx || !ctx.branchId) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    this.server
      .to(`branch:${ctx.branchId}`)
      .emit('server:order:new', data);

    this.server.to(`role:${S.Role.CASHIER}`).emit('server:order:new', data);

    try {
      await this.auditLogsService.append({
        restaurantId: ctx.restaurantId,
        branchId: ctx.branchId,
        entityType: 'ORDER',
        entityId: (data.orderId as string) ?? null,
        action: S.AuditAction.CREATE,
        performedBy: ctx.employeeId ?? ctx.userId,
        performedByRole: ctx.role,
        deviceId: (socket.handshake.headers['x-device-id'] as string) ?? null,
        metadata: { source: 'socket-order-submit' },
      });
    } catch (auditErr) {
      this.logger.error(`Audit append failed: ${(auditErr as Error).message}`);
    }
  }

  @SubscribeMessage('client:order:status-update')
  async handleOrderStatusUpdate(
    socket: Socket,
    data: { orderId: string; status: S.OrderStatus }
  ): Promise<void> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx || !ctx.branchId) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    this.server
      .to(`branch:${ctx.branchId}`)
      .emit('server:order:status', {
        orderId: data.orderId,
        status: data.status,
        timestamp: new Date(),
      });

    const tableId = (socket.handshake.auth?.tableId as string) ||
      (socket.handshake.query?.tableId as string);
    if (tableId) {
      this.server
        .to(`table:${tableId}`)
        .emit('server:order:customer', {
          orderId: data.orderId,
          status: data.status,
        });
    }
  }

  @SubscribeMessage('client:kitchen:status')
  async handleKitchenStatus(
    socket: Socket,
    data: { kitchenOrderId: string; status: S.KitchenStatus }
  ): Promise<void> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx || !ctx.branchId) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    this.server
      .to(`branch:${ctx.branchId}`)
      .emit('server:kitchen:status', {
        kitchenOrderId: data.kitchenOrderId,
        status: data.status,
        timestamp: new Date(),
      });
  }

  @SubscribeMessage('client:menu:oos')
  async handleMenuOos(
    socket: Socket,
    data: { menuItemId: string; isOutOfStock: boolean }
  ): Promise<void> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx || !ctx.branchId) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    const payload = {
      menuItemId: data.menuItemId,
      status: data.isOutOfStock
        ? S.MenuItemStatus.OUT_OF_STOCK
        : S.MenuItemStatus.AVAILABLE,
      branchId: ctx.branchId,
      timestamp: new Date(),
    };

    this.server.to(`branch:${ctx.branchId}`).emit('menu:item:status:changed', payload);

    this.server.emit('menu:public', payload);
  }

  @SubscribeMessage('client:table:call-waiter')
  async handleCallWaiter(
    socket: Socket,
    data: { tableId: string }
  ): Promise<void> {
    const ctx = socket.data.ctx as AuthContext | undefined;
    if (!ctx) {
      socket.emit('error', { message: 'Unauthorized' });
      return;
    }

    const branchId = ctx.branchId ?? (socket.handshake.auth?.branchId as string);
    if (!branchId) return;

    this.server.to(`role:${S.Role.WAITER}`).emit('server:table:waiter-call', {
      tableId: data.tableId,
      branchId,
      timestamp: new Date(),
      requestedBy: ctx.userId,
    });
  }
}
