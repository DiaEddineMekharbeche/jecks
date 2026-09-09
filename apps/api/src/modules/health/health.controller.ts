import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/auth.decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /** Readiness fails loudly when the database is unreachable, so a deploy can roll back. */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe including a database round-trip' })
  async ready() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: { ok: true, latencyMs: Date.now() - started } };
  }
}
