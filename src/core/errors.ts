/** A typed error returned by the canvas core for a rejected request. */
export class CanvasError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "CanvasError";
    this.code = code;
    this.details = details;
  }
}
