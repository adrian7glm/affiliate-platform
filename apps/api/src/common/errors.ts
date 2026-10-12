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
    // By name too: a package loaded through another module system has its own ZodError class.
    if (exception instanceof ZodError || (exception as Error | null)?.name === 'ZodError') {
      const issues = (exception as ZodError).issues;
      return {
        statusCode: 400,
        error: 'Bad Request',
        message: issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        details: issues,
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
    return { statusCode: 500, error: 'Internal Server Error', message: 'something went wrong' };
  }
}
