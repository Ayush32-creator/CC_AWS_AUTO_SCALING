import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

/** Converts any thrown error into the standard `{ error: {...} }` JSON shape. */
export function errorHandler(err, req, res, _next) {
  const requestId = req.id;

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId,
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
  }

  // Malformed JSON body or oversized payload (raised by express.json()).
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId } });
  }

  // Unknown failure: log the details, return a generic message.
  req.log?.error({ err }, 'Unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', requestId },
  });
}

export function apiNotFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, requestId: req.id },
  });
}
