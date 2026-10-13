import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@ap/contracts';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { reportError } from './error-reporting';

/** Variables of a translated error message. */
export type ErrorVars = Readonly<Record<string, string | number>>;

/**
 * Business rule violation shown to the user. `code` is a key in the `errors` section of the
 * language files (packages/i18n/src/locales); the message is translated into the request's
 * language when the response is written.
 */
export class DomainError extends HttpException {
  constructor(
    readonly code: `errors.${string}`,
    status: HttpStatus = HttpStatus.UNPROCESSABLE_ENTITY,
    details?: unknown,
    readonly vars?: ErrorVars,
  ) {
    super({ message: code, code, details, vars }, status);
  }
}

/** `new NotFound('product')` → `errors.notFound.product` ("product not found"). */
export class NotFound extends DomainError {
  constructor(what: string) {
    super(`errors.notFound.${what}`, HttpStatus.NOT_FOUND);
  }
}

/** Translates error codes into the language of a request. */
export interface ErrorTranslator {
  langOf(request: Request): string;
  translate(lang: string, code: string, vars?: ErrorVars): string;
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

  constructor(private readonly i18n: ErrorTranslator) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const body = this.toBody(exception);
    if (body.code) {
      const lang = this.i18n.langOf(http.getRequest<Request>());
      body.message = this.i18n.translate(lang, body.code, body.vars);
    }
    delete body.vars;
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
      reportError(exception, { path: http.getRequest<Request>().path });
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiError & { vars?: ErrorVars } {
    if (isZodError(exception)) {
      const issues = exception.issues;
      return {
        statusCode: 400,
        error: 'Bad Request',
        code: 'errors.validation',
        message: issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        vars: {
          fields: [...new Set(issues.map((i) => i.path.join('.') || 'body'))].join(', '),
          details: issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        },
        details: issues,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const payload =
        typeof raw === 'string'
          ? { message: raw }
          : (raw as { message?: unknown; details?: unknown; code?: unknown; vars?: ErrorVars });
      const message = Array.isArray(payload.message)
        ? payload.message.join('; ')
        : String(payload.message ?? exception.message);
      return {
        statusCode: status,
        error: HttpStatus[status]?.toString().replace(/_/g, ' ').toLowerCase() ?? 'error',
        message,
        ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
        ...(payload.vars ? { vars: payload.vars } : {}),
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
        code: 'errors.badRequest',
        message: String(parser.message ?? 'bad request').toLowerCase(),
      };
    }
    return {
      statusCode: 500,
      error: 'Internal Server Error',
      code: 'errors.internal',
      message: 'something went wrong',
    };
  }
}
