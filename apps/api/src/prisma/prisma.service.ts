import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@jecks/db';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Wipes every table except the reference data a test still needs. Used only by the
   * integration suite; refuses to run outside NODE_ENV=test.
   */
  async truncateForTests(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('truncateForTests() is only available with NODE_ENV=test');
    }
    const rows = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;
    const tables = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
    if (tables) await this.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);
  }
}
