import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/auth.decorators';
import { ConnectService } from './connect.service';

const STATE_COOKIE = 'owa_connect_state';

/**
 * "Sign in with WorkHub" browser flow for the dashboard. Every route is @Public — this IS the login,
 * so there is no api key yet. Only GET /connect/config is part of the documented API (the login
 * screen asks whether the button should show); start/callback/claim are browser-flow plumbing and are
 * excluded from the OpenAPI contract.
 *
 *   GET  /connect/start    → redirect the browser to WorkHub's consent page (PKCE + state cookie).
 *   GET  /connect/callback → WorkHub returns here; exchange the code, mint a tenant key, hand off.
 *   POST /connect/claim    → the SPA redeems the one-time handoff for the minted key.
 *
 * On the /api global prefix these are /api/connect/*; the SPA root ("/") is the dashboard, so a
 * success redirect to `/?workhub=<id>` lands on the SPA, which redeems the handoff and signs in.
 *
 * Every route is excluded from the OpenAPI document (@ApiExcludeEndpoint): this is browser-flow
 * plumbing and a tiny login-screen probe, not part of the REST API contract the SDKs mirror.
 */
@Controller('connect')
@Public()
export class ConnectController {
  constructor(private readonly connect: ConnectService) {}

  @Get('config')
  @ApiExcludeEndpoint()
  config(): { enabled: boolean } {
    return { enabled: this.connect.enabled };
  }

  @Get('start')
  @ApiExcludeEndpoint()
  start(@Res() res: Response): void {
    if (!this.connect.enabled) {
      res.redirect(302, '/?workhub_error=disabled');
      return;
    }
    const { authorizeUrl, state } = this.connect.startFlow();
    // Bind this flow to THIS browser so a state an attacker started cannot be completed in the
    // victim's session (login CSRF). httpOnly + SameSite=Lax: unreadable to scripts, yet still sent
    // on the top-level GET redirect back from WorkHub. Secure in production.
    res.setHeader('Set-Cookie', this.stateCookie(state, 600));
    res.redirect(302, authorizeUrl);
  }

  @Get('callback')
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Set-Cookie', this.stateCookie('', 0)); // burn the state cookie either way
    if (error) {
      res.redirect(302, '/?workhub_error=denied');
      return;
    }
    const cookieState = this.readStateCookie(req.headers.cookie);
    if (!state || !cookieState || cookieState !== state) {
      res.redirect(302, '/?workhub_error=state');
      return;
    }
    try {
      const handoffId = await this.connect.handleCallback(code ?? '', state);
      res.redirect(302, `/?workhub=${encodeURIComponent(handoffId)}`);
    } catch {
      res.redirect(302, '/?workhub_error=failed');
    }
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  claim(@Body() body: { handoff?: string }): { apiKey: string } {
    const key = this.connect.claim(typeof body?.handoff === 'string' ? body.handoff : '');
    if (!key) throw new BadRequestException('handoff_invalid');
    return { apiKey: key };
  }

  /** The state cookie is scoped to /api/connect (where it is set and read), and nowhere else. */
  private stateCookie(value: string, maxAgeSeconds: number): string {
    const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
    return `${STATE_COOKIE}=${value}; Path=/api/connect; HttpOnly; SameSite=Lax;${secure} Max-Age=${maxAgeSeconds}`;
  }

  private readStateCookie(header: string | undefined): string | null {
    if (!header) return null;
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === STATE_COOKIE) return rest.join('=') || null;
    }
    return null;
  }
}
