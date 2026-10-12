import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@ap/contracts';
import type { Response } from 'express';
import { ZodError } from 'zod';

/** Business rule violation with a message safe to show to the user. */
export class DomainError extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    details?: unknown,
  ) {
    super({ message, details }, status);
  }
}

export class NotFound extends DomainError {
  constructor(what: string) {
    super(`${what} not found`, HttpStatus.NOT_FOUND);
  }
}

// By name too: the schemas in @ap/contracts may load a different copy of zod (CJS vs ESM).
function isZodError(error: unknown): error is ZodError {
  return (
    error instanceof ZodError ||
    (error instanceof Error &&
      error.name === 'ZodError' &&
      Array.isArray((error as Partial<ZodError>).issues))
  );
}

/** Renders every error as `{ statusCode, error, message, details? }`. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500)
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiError {
    if (isZodError(exception)) {
      return {
        statusCode: 400,
        error: 'Bad Request',
        message: exception.issues
          .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
          .join('; '),
        details: exception.issues,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const payload =
        typeof raw === 'string'
          ? { message: raw }
          : (raw as { message?: unknown; details?: unknown });
      const message = Array.isArray(payload.message)
        ? payload.message.join('; ')
        : String(payload.message ?? exception.message);
      return {
        statusCode: status,
        error: HttpStatus[status]?.toString().replace(/_/g, ' ').toLowerCase() ?? 'error',
        message,
        ...(payload.details === undefined ? {} : { details: payload.details }),
      };
    }
    // Errors from the body parser (request too large, malformed JSON) carry a safe 4xx status.
    const parser = exception as { status?: unknown; expose?: unknown; message?: unknown } | null;
    if (
      parser &&
      parser.expose === true &&
      typeof parser.status === 'number' &&
      parser.status >= 400 &&
      parser.status < 500
    ) {
      return {
        statusCode: parser.status,
        error: HttpStatus[parser.status]?.toString().replace(/_/g, ' ').toLowerCase() ?? 'error',
        message: String(parser.message ?? 'bad request').toLowerCase(),
      };
    }
    return { statusCode: 500, error: 'Internal Server Error', message: 'something went wrong' };
  }
}
