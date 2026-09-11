import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  enable2faSchema,
  otpRequestSchema,
  otpVerifySchema,
  staffLoginSchema,
  type OtpRequestInput,
  type OtpVerifyInput,
  type StaffLoginInput,
} from '@jecks/shared';
import type { Response } from 'express';
import {
  CurrentUser,
  Public,
  type AuthenticatedUser,
  type RequestWithUser,
} from '../../common/decorators/auth.decorators.js';
import { zod } from '../../common/pipes/zod-validation.pipe.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { CSRF_COOKIE, issueCsrfToken } from '../../common/guards/csrf.guard.js';

const REFRESH_COOKIE = 'jk_refresh';
/**
 * The storefront's access token also travels as an httpOnly cookie.
 *
 * A Next.js Server Component render has no JavaScript context to hold a token in, and
 * an access token kept in browser JavaScript is one XSS away from being stolen. The
 * guard already reads this cookie; the admin, which is a single-page app that can hold
 * a token in memory, ignores it and keeps using the Authorization header.
 */
const ACCESS_COOKIE = 'jk_access';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Staff sign-in with e-mail, password and optional TOTP' })
  async loginStaff(
    @Body(zod(staffLoginSchema)) body: StaffLoginInput,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.auth.loginStaff(body.email, body.password, body.totp, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return this.respond(issued, response);
  }

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a one-time code to an Algerian phone number' })
  async requestOtp(
    @Body(zod(otpRequestSchema)) body: OtpRequestInput,
    @Req() request: RequestWithUser,
  ) {
    return this.auth.requestOtp(body.phone, body.purpose, request.ip);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a one-time code for a session' })
  async verifyOtp(
    @Body(zod(otpVerifySchema)) body: OtpVerifyInput,
    @Req() request: RequestWithUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const issued = await this.auth.verifyOtp(body.phone, body.code, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return this.respond(issued, response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh cookie for a fresh access token' })
  async refresh(@Req() request: RequestWithUser, @Res({ passthrough: true }) response: Response) {
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException({ code: 'REFRESH_MISSING', message: 'Please sign in again' });
    }
    const issued = await this.auth.refresh(token, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return this.respond(issued, response);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    response.clearCookie(ACCESS_COOKIE, this.cookieOptions());
    response.clearCookie(CSRF_COOKIE, { ...this.cookieOptions(), httpOnly: false });
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke every session for the signed-in user' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutEverywhere(user.id);
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    response.clearCookie(ACCESS_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user with their roles and permissions' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.loadSessionUser(user.id);
  }

  @Post('2fa/begin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate a TOTP secret to show as a QR code' })
  async beginTwoFactor(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.beginTwoFactor(user.id);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm the TOTP secret with a code and switch 2FA on' })
  async enableTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zod(enable2faSchema)) body: { secret: string; code: string },
  ): Promise<void> {
    await this.auth.enableTwoFactor(user.id, body.secret, body.code);
  }

  /**
   * The refresh token lives in an httpOnly cookie (PRD Section 10.3) and never reaches
   * JavaScript; the access token goes in the body for the client to hold in memory.
   */
  private respond(issued: IssuedSession, response: Response) {
    response.cookie(REFRESH_COOKIE, issued.refreshToken, {
      ...this.cookieOptions(),
      maxAge: 30 * 86_400_000,
    });
    response.cookie(ACCESS_COOKIE, issued.tokens.accessToken, {
      ...this.cookieOptions(),
      maxAge: issued.tokens.expiresIn * 1000,
    });

    // The CSRF token the refresh and logout routes will require back as a header. It is
    // deliberately readable by script: it proves the caller could read our cookies, not
    // that they are anybody in particular.
    const csrfToken = issueCsrfToken(
      response,
      this.config.get<boolean>('COOKIE_SECURE') ?? false,
      this.config.get<string>('COOKIE_DOMAIN') ?? 'localhost',
    );

    return { data: { ...issued.tokens, csrfToken, user: issued.user } };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('COOKIE_SECURE') ?? false,
      sameSite: 'lax' as const,
      domain: this.config.get<string>('COOKIE_DOMAIN'),
      path: '/',
    };
  }
}
