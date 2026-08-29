import { Body, Controller, HttpCode, Post, UseGuards, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { loginSchema, LoginInput } from '@prolific/validation';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Audit } from '../common/decorators/audit.decorator';
import { AuditAction, Role as RoleType } from '@prolific/shared-types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Audit({ action: AuditAction.LOGIN, entityType: 'AUTH' })
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    const result = await this.auth.login(body.email, body.password, {
      branchId: body.branchId,
    });
    return {
      ...result.tokens,
      user: result.user,
      employee: result.employee,
      restaurant: result.restaurant,
      branch: result.branch,
      branches: result.branches,
    };
  }

  @Public()
  @Post('pin/login')
  @HttpCode(200)
  @Audit({ action: AuditAction.LOGIN, entityType: 'AUTH' })
  async loginWithPin(
    @Body()
    body: {
      pin: string;
      branchId?: string;
      deviceId?: string;
    }
  ) {
    // #region debug-point pos-pin-login-not-working:F-controller-entry
    (()=>{try{const fs=require('fs'),paths=[`${process.cwd()}/.dbg/pos-pin-login-not-working.env`,`${process.cwd()}/../.dbg/pos-pin-login-not-working.env`,`${process.cwd()}/../../.dbg/pos-pin-login-not-working.env`];let u='http://127.0.0.1:7777/event',s='pos-pin-login-not-working';try{const p=paths.find(p=>{try{fs.readFileSync(p,'utf8');return true}catch{return false}});if(p){const e=fs.readFileSync(p,'utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}}catch{}const http=require('http');const body_s=JSON.stringify({ts:Date.now(),sessionId:s,runId:'pre-fix',hypothesisId:'H4',location:'auth.controller.ts:pin/login',msg:'[DEBUG] pin/login controller entry',data:{bodyKeys:Object.keys(body||{}),pinType:typeof body?.pin,pinLen:body?.pin?String(body.pin).length:0,pinDigitsOnly:body?.pin?!/^\d+$/.test(String(body.pin)):null,branchId:body?.branchId??null,hasDeviceId:Boolean(body?.deviceId)}});const url=require('url').parse(u);const req=http.request({hostname:url.hostname,port:url.port,path:url.pathname,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body_s)}},r=>r.resume());req.on('error',()=>{});req.write(body_s);req.end()}catch{}})();
    // #endregion
    if (!body?.pin) throw new Error('pin required');
    // branchId is now OPTIONAL — when omitted the backend resolves the
    // employee's assigned branch automatically so the POS no longer needs
    // to prompt for branch selection before login.
    const result = await this.auth.loginWithPin(body.pin, {
      branchId: body.branchId,
      deviceId: body.deviceId,
    });
    return {
      ...result.tokens,
      user: result.user,
      employee: result.employee,
      restaurant: result.restaurant,
      branch: result.branch,
      branches: result.branches,
    };
  }

  @Post('pin/change')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePin(
    @CurrentUser() user: AuthContext,
    @Body() body: { currentPin: string; newPin: string }
  ) {
    return this.auth.changePin(user, body?.currentPin, body?.newPin);
  }

  @Post('select-branch')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async selectBranch(
    @CurrentUser() user: AuthContext,
    @Body() body: { branchId: string }
  ) {
    if (!body?.branchId) {
      throw new Error('branchId required');
    }
    const result = await this.auth.selectBranch(user, body.branchId);
    return {
      ...result.tokens,
      user: result.user,
      employee: result.employee,
      restaurant: result.restaurant,
      branch: result.branch,
      branches: result.branches,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body?.refreshToken) throw new Error('refreshToken required');
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @Audit({ action: AuditAction.LOGOUT, entityType: 'AUTH' })
  async logout(@Body() body: { refreshToken?: string }) {
    if (body?.refreshToken) await this.auth.logout(body.refreshToken);
  }

  /** Manager PIN verification — returns short-lived approval JWT */
  @Post('pin/verify')
  @HttpCode(200)
  async verifyPin(
    @CurrentUser() user,
    @Body()
    body: {
      pin: string;
      action: AuditAction;
      entityType: string;
      entityId: string;
    }
  ) {
    const branchId = user.branchId;
    if (!branchId) throw new Error('Branch context required');
    return this.auth.verifyPinAndIssueApproval(body.pin, branchId, {
      action: body.action,
      entityType: body.entityType,
      entityId: body.entityId,
      requestingEmployeeId: user.employeeId,
    });
  }

  @Get('me')
  @HttpCode(200)
  async me(@CurrentUser() user) {
    return { user };
  }
}
