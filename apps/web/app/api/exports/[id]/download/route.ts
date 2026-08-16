import { requireSession } from '@racio/auth';
import { downloadExport } from '@racio/export';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { getPrivateStorage } from '../../../../../lib/storage';
import { apiError } from '../../../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(await headers());
    const { id } = await params;
    const file = await downloadExport(
      database.db,
      getPrivateStorage(),
      session.user.id,
      id,
      new Date(),
    );
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Content-Length': String(file.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
