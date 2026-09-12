import { RoleSlug } from '@jecks/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestApp } from '../../testing/app.js';
import { signInAs } from '../../testing/auth.js';

/**
 * The in-app inbox — PRD Section 6.1.
 *
 * The interesting question is isolation. These rows are not gated by a permission,
 * because they are personal rather than a shop resource, so the only thing standing
 * between one staff member and another's notifications is the query. That deserves a
 * test more than the happy path does.
 */

let test: TestApp;
let owner: { userId: string; bearer: string };
let agent: { userId: string; bearer: string };

beforeAll(async () => {
  test = await createTestApp();
  owner = await signInAs(test, RoleSlug.OWNER);
  agent = await signInAs(test, RoleSlug.ORDER_AGENT);
}, 180_000);

afterAll(async () => {
  await test?.close();
});

beforeEach(async () => {
  await resetData(test.prisma);
});

async function notification(options: {
  userId: string | null;
  title: string;
  read?: boolean;
  channel?: string;
}) {
  return test.prisma.notification.create({
    data: {
      userId: options.userId,
      channel: (options.channel ?? 'IN_APP') as never,
      event: 'inventory.low',
      title: options.title,
      status: 'sent',
      readAt: options.read ? new Date() : null,
    },
  });
}

describe('GET /me/notifications', () => {
  it('returns mine, newest first, with the unread count', async () => {
    await notification({ userId: owner.userId, title: 'Première' });
    await notification({ userId: owner.userId, title: 'Seconde' });

    const response = await test.http
      .get('/api/v1/me/notifications')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.items[0].title).toBe('Seconde');
    expect(response.body.data.unread).toBe(2);
  });

  it('does not return another person’s notifications', async () => {
    await notification({ userId: agent.userId, title: 'Pour l’agent' });

    const response = await test.http
      .get('/api/v1/me/notifications')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data.items).toHaveLength(0);
  });

  it('returns a shop-wide alert to everybody, because it names nobody', async () => {
    // "Stock is low" is for whoever is minding the shop.
    await notification({ userId: null, title: 'Stock faible' });

    for (const session of [owner, agent]) {
      const response = await test.http
        .get('/api/v1/me/notifications')
        .set('Authorization', session.bearer)
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].shared).toBe(true);
    }
  });

  it('ignores the rows that went out by SMS, which are a delivery log not an inbox', async () => {
    await notification({ userId: owner.userId, title: 'SMS client', channel: 'SMS' });

    const response = await test.http
      .get('/api/v1/me/notifications')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data.items).toHaveLength(0);
  });

  it('counts only the unread ones', async () => {
    await notification({ userId: owner.userId, title: 'Lue', read: true });
    await notification({ userId: owner.userId, title: 'Non lue' });

    const response = await test.http
      .get('/api/v1/me/notifications/count')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data.unread).toBe(1);
  });

  it('refuses a caller with no session', async () => {
    await test.http.get('/api/v1/me/notifications').expect(401);
  });
});

describe('marking read', () => {
  it('marks one and drops it out of the count', async () => {
    const row = await notification({ userId: owner.userId, title: 'À lire' });

    await test.http
      .post(`/api/v1/me/notifications/${row.id}/read`)
      .set('Authorization', owner.bearer)
      .expect(200);

    const count = await test.http
      .get('/api/v1/me/notifications/count')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(count.body.data.unread).toBe(0);
  });

  it('keeps the original moment when marked twice', async () => {
    const row = await notification({ userId: owner.userId, title: 'À lire' });

    await test.http
      .post(`/api/v1/me/notifications/${row.id}/read`)
      .set('Authorization', owner.bearer)
      .expect(200);

    const first = await test.prisma.notification.findUniqueOrThrow({ where: { id: row.id } });

    await test.http
      .post(`/api/v1/me/notifications/${row.id}/read`)
      .set('Authorization', owner.bearer)
      .expect(200);

    const second = await test.prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(second.readAt?.getTime()).toBe(first.readAt?.getTime());
  });

  it('refuses to mark somebody else’s, and says not found rather than forbidden', async () => {
    // Whether another person's notification exists is not a question this answers.
    const row = await notification({ userId: agent.userId, title: 'Pour l’agent' });

    await test.http
      .post(`/api/v1/me/notifications/${row.id}/read`)
      .set('Authorization', owner.bearer)
      .expect(404);

    const after = await test.prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.readAt).toBeNull();
  });

  it('clears the badge in one call', async () => {
    await notification({ userId: owner.userId, title: 'A' });
    await notification({ userId: owner.userId, title: 'B' });
    await notification({ userId: null, title: 'Partagée' });

    const response = await test.http
      .post('/api/v1/me/notifications/read-all')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(response.body.data.read).toBe(3);

    const count = await test.http
      .get('/api/v1/me/notifications/count')
      .set('Authorization', owner.bearer)
      .expect(200);

    expect(count.body.data.unread).toBe(0);
  });

  it('does not clear another person’s badge', async () => {
    await notification({ userId: agent.userId, title: 'Pour l’agent' });

    await test.http
      .post('/api/v1/me/notifications/read-all')
      .set('Authorization', owner.bearer)
      .expect(200);

    const count = await test.http
      .get('/api/v1/me/notifications/count')
      .set('Authorization', agent.bearer)
      .expect(200);

    expect(count.body.data.unread).toBe(1);
  });
});
