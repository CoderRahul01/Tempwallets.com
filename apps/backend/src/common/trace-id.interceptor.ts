import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';

export const TRACE_ID_HEADER = 'x-trace-id';
export const TRACE_ID_KEY = 'traceId';

/**
 * Interceptor to handle trace ID propagation across requests
 *
 * - Extracts trace ID from request headers (if present)
 * - Generates new trace ID if not present
 * - Adds trace ID to response headers
 * - Makes trace ID available to all services via request object
 */
@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Extract or generate trace ID
    let traceId = request.headers[TRACE_ID_HEADER];
    if (!traceId) {
      traceId = randomUUID();
    }

    // Store in request for access by services
    request[TRACE_ID_KEY] = traceId;

    // Add to response headers for client correlation
    response.setHeader(TRACE_ID_HEADER, traceId);

    return next.handle();
  }
}

/**
 * Helper to extract trace ID from request
 * Use this in your services to get the current trace ID
 *
 * @example
 * ```ts
 * import { getTraceId } from './common/trace-id.interceptor';
 *
 * @Injectable()
 * export class MyService {
 *   async doSomething(@Req() request) {
 *     const traceId = getTraceId(request);
 *     this.logger.log('Operation started', { traceId });
 *   }
 * }
 * ```
 */
export function getTraceId(request: any): string | undefined {
  return request?.[TRACE_ID_KEY];
}
