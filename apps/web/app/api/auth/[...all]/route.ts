import { getAuth } from '@racio/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  return (await getAuth()).handler(request);
}

export async function POST(request: Request) {
  return (await getAuth()).handler(request);
}

export async function PATCH(request: Request) {
  return (await getAuth()).handler(request);
}

export async function PUT(request: Request) {
  return (await getAuth()).handler(request);
}

export async function DELETE(request: Request) {
  return (await getAuth()).handler(request);
}
