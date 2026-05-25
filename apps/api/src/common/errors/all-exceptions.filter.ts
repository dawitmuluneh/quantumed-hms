import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';

import { DomainError } from './domain-error';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  request_id: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? nanoid(12);

    const envelope = this.toEnvelope(exception, requestId);
    const status = this.toStatus(exception);

    if (status >= 500) {
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${envelope.error.code}: ${envelope.error.message}`,
      );
    } else {
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} -> ${status} ${envelope.error.code}`,
      );
    }

    response.setHeader('x-request-id', requestId);
    response.status(status).json(envelope);
  }

  private toStatus(exception: unknown): number {
    if (exception instanceof DomainError) return exception.httpStatus;
    if (exception instanceof HttpException) return exception.getStatus();
    return 500;
  }

  private toEnvelope(exception: unknown, requestId: string): ErrorEnvelope {
    if (exception instanceof DomainError) {
      return {
        error: { code: exception.code, message: exception.message, details: exception.details },
        request_id: requestId,
      };
    }
    if (exception instanceof HttpException) {
      const resp = exception.getResponse();
      const message =
        typeof resp === 'string'
          ? resp
          : ((resp as { message?: string }).message ?? exception.message);
      return {
        error: { code: this.codeFromStatus(exception.getStatus()), message, details: resp },
        request_id: requestId,
      };
    }
    const message = exception instanceof Error ? exception.message : 'Internal server error';
    return {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: { hint: message },
      },
      request_id: requestId,
    };
  }

  private codeFromStatus(status: number): string {
    switch (status) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'VALIDATION_FAILED';
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'HTTP_ERROR';
    }
  }
}
