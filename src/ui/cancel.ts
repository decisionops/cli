export class CancelError extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "CancelError";
  }
}

export function isCancelError(error: unknown): error is CancelError {
  return error instanceof CancelError;
}
