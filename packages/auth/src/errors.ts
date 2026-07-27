export class AuthBoundaryError extends Error {
  constructor(
    public readonly code: 'UNAUTHENTICATED' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'AuthBoundaryError';
  }
}
