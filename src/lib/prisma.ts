import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Wraps a Prisma operation with automatic retry on connection errors.
 * Neon serverless cold-starts can cause the first query to fail —
 * retrying once after a short delay is enough to recover.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1500
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isConnErr =
        err?.message?.includes("Can't reach database") ||
        err?.message?.includes('Connection refused') ||
        err?.message?.includes('ECONNREFUSED') ||
        err?.code === 'P1001' ||
        err?.code === 'P1002';

      if (!isConnErr || attempt === retries) throw err;

      console.warn(
        `[Prisma] Connection error on attempt ${attempt}/${retries}. Retrying in ${delayMs}ms...`
      );
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2; // exponential backoff
    }
  }
  throw lastError;
}

export default prisma;
