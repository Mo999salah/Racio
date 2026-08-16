export class AuthBoundaryError extends Error {
  constructor(
    public readonly code:
      | 'UNAUTHENTICATED'
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | `XLSX_${string}`
      | `PDF_${string}`
      | `EXPORT_${string}`,
    message: string,
  ) {
    super(message);
    this.name = 'AuthBoundaryError';
  }
}
