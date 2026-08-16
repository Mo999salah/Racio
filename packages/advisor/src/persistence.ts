import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from '@racio/auth';

/**
 * User-owned advisor persistence: threads, messages, and pending proposals.
 * Messages store only the user-visible question/answer text (bounded); tool
 * results, provider reasoning, and chain-of-thought are never persisted.
 * Proposals are server-stored so confirmation never trusts a client-resubmitted
 * AI payload.
 */

const MAX_MESSAGE_CONTENT = 8_000;
const MAX_THREAD_TITLE = 160;

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function conflict(message: string): never {
  throw new AuthBoundaryError('CONFLICT', message);
}

export async function createThread(
  db: RacioDatabase,
  userId: string,
  title?: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.advisorThreads)
    .values({ id: randomUUID(), userId, title: title?.slice(0, MAX_THREAD_TITLE) ?? null })
    .returning({ id: schema.advisorThreads.id });
  if (!row) throw new Error('Thread insert did not return a row.');
  return row.id;
}

async function ownedThread(db: RacioDatabase, userId: string, threadId: string) {
  const [row] = await db
    .select({ id: schema.advisorThreads.id })
    .from(schema.advisorThreads)
    .where(and(eq(schema.advisorThreads.id, threadId), eq(schema.advisorThreads.userId, userId)))
    .limit(1);
  if (!row) notFound('Advisor thread not found.');
  return row;
}

export async function appendMessage(
  db: RacioDatabase,
  userId: string,
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<string> {
  const [thread] = await db
    .select({ id: schema.advisorThreads.id, archivedAt: schema.advisorThreads.archivedAt })
    .from(schema.advisorThreads)
    .where(and(eq(schema.advisorThreads.id, threadId), eq(schema.advisorThreads.userId, userId)))
    .limit(1);
  if (!thread) notFound('Advisor thread not found.');
  if (thread.archivedAt) conflict('Archived conversations cannot be continued.');
  const bounded = content.slice(0, MAX_MESSAGE_CONTENT);
  const [row] = await db
    .insert(schema.advisorMessages)
    .values({ id: randomUUID(), userId, threadId, role, content: bounded })
    .returning({ id: schema.advisorMessages.id });
  await db
    .update(schema.advisorThreads)
    .set({ updatedAt: new Date() })
    .where(and(eq(schema.advisorThreads.id, threadId), eq(schema.advisorThreads.userId, userId)));
  if (!row) throw new Error('Message insert did not return a row.');
  return row.id;
}

export async function listThreads(db: RacioDatabase, userId: string, limit = 20) {
  const rows = await db
    .select({
      id: schema.advisorThreads.id,
      title: schema.advisorThreads.title,
      archivedAt: schema.advisorThreads.archivedAt,
      createdAt: schema.advisorThreads.createdAt,
      updatedAt: schema.advisorThreads.updatedAt,
    })
    .from(schema.advisorThreads)
    .where(eq(schema.advisorThreads.userId, userId))
    .orderBy(desc(schema.advisorThreads.updatedAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function listMessages(
  db: RacioDatabase,
  userId: string,
  threadId: string,
  limit = 100,
) {
  await ownedThread(db, userId, threadId);
  const rows = await db
    .select({
      id: schema.advisorMessages.id,
      role: schema.advisorMessages.role,
      content: schema.advisorMessages.content,
      createdAt: schema.advisorMessages.createdAt,
    })
    .from(schema.advisorMessages)
    .where(
      and(eq(schema.advisorMessages.userId, userId), eq(schema.advisorMessages.threadId, threadId)),
    )
    .orderBy(asc(schema.advisorMessages.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function archiveThread(db: RacioDatabase, userId: string, threadId: string) {
  await ownedThread(db, userId, threadId);
  await db
    .update(schema.advisorThreads)
    .set({ archivedAt: new Date() })
    .where(and(eq(schema.advisorThreads.id, threadId), eq(schema.advisorThreads.userId, userId)));
  return true;
}

export async function restoreThread(db: RacioDatabase, userId: string, threadId: string) {
  await ownedThread(db, userId, threadId);
  await db
    .update(schema.advisorThreads)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(schema.advisorThreads.id, threadId), eq(schema.advisorThreads.userId, userId)));
  return true;
}

/**
 * Hard delete: removes the conversation and all of its messages. Conversations
 * store only bounded user-visible text with no audit dependency, so nothing is
 * retained while presenting the conversation as deleted. Proposals live in
 * `advisor_proposals` and are deliberately NOT linked to threads: deleting a
 * conversation never confirms, expires, or otherwise touches a proposal.
 */
export async function deleteThread(db: RacioDatabase, userId: string, threadId: string) {
  await ownedThread(db, userId, threadId);
  await db
    .delete(schema.advisorMessages)
    .where(
      and(eq(schema.advisorMessages.userId, userId), eq(schema.advisorMessages.threadId, threadId)),
    );
  await db
    .delete(schema.advisorThreads)
    .where(and(eq(schema.advisorThreads.id, threadId), eq(schema.advisorThreads.userId, userId)));
  return true;
}

export type StoredProposal = {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  status: 'pending' | 'executed' | 'expired' | 'cancelled';
  expiresAt: Date;
  executedAt: Date | null;
  result: unknown;
};

export async function createProposal(
  db: RacioDatabase,
  userId: string,
  type: string,
  payload: unknown,
  expiresAt: Date,
): Promise<StoredProposal> {
  const [row] = await db
    .insert(schema.advisorProposals)
    .values({ id: randomUUID(), userId, type, payload, expiresAt })
    .returning();
  if (!row) throw new Error('Proposal insert did not return a row.');
  return mapProposal(row);
}

export async function getOwnedProposal(
  db: RacioDatabase,
  userId: string,
  proposalId: string,
): Promise<StoredProposal | null> {
  const [row] = await db
    .select()
    .from(schema.advisorProposals)
    .where(
      and(eq(schema.advisorProposals.id, proposalId), eq(schema.advisorProposals.userId, userId)),
    )
    .limit(1);
  return row ? mapProposal(row) : null;
}

export async function markProposalExpired(db: RacioDatabase, userId: string, proposalId: string) {
  await db
    .update(schema.advisorProposals)
    .set({ status: 'expired' })
    .where(
      and(eq(schema.advisorProposals.id, proposalId), eq(schema.advisorProposals.userId, userId)),
    );
}

export async function markProposalExecuted(
  db: RacioDatabase,
  userId: string,
  proposalId: string,
  result: unknown,
) {
  const [row] = await db
    .update(schema.advisorProposals)
    .set({ status: 'executed', executedAt: new Date(), result })
    .where(
      and(eq(schema.advisorProposals.id, proposalId), eq(schema.advisorProposals.userId, userId)),
    )
    .returning();
  if (!row) notFound('Proposal not found.');
  return mapProposal(row);
}

function mapProposal(row: typeof schema.advisorProposals.$inferSelect): StoredProposal {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: row.payload,
    status: row.status,
    expiresAt: row.expiresAt,
    executedAt: row.executedAt,
    result: row.result,
  };
}
