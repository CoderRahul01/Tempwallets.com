import { Injectable } from '@nestjs/common';

/**
 * Metrics Service for Backend Observability
 *
 * Separates metrics from logs for better observability.
 * Use this for:
 * - Counting events (API requests, errors, successes)
 * - Measuring performance (duration, latency)
 * - Tracking values (queue size, active connections)
 *
 * In production, this would integrate with Prometheus, DataDog, etc.
 * For now, it provides a consistent interface for metrics collection.
 */

interface MetricData {
  [key: string]: string | number | boolean;
}

@Injectable()
export class MetricsService {
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.ENABLE_METRICS !== 'false';
  }

  /**
   * Increment a counter by 1 (or specified value)
   * Use for: counting events, requests, errors
   *
   * @example
   * ```ts
   * this.metricsService.increment('api.request.count', { endpoint: '/balance', status: 200 });
   * this.metricsService.increment('webhook.received', { type: 'balance_update' });
   * this.metricsService.increment('error.count', { type: 'network', service: 'zerion' });
   * ```
   */
  increment(name: string, tags: MetricData = {}, value: number = 1): void {
    if (!this.enabled) return;

    // In development, log to console
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[METRIC] Counter: ${name} +${value}`, tags);
    }

    // In production, this would send to your metrics backend
    // Example: prometheusClient.increment(name, value, tags);
  }

  /**
   * Set a gauge value (current state)
   * Use for: tracking current values like queue size, active connections
   *
   * @example
   * ```ts
   * this.metricsService.gauge('wallet.balance.usd', 1234.56, { walletAddress: '0x...' });
   * this.metricsService.gauge('websocket.connections', 5);
   * this.metricsService.gauge('cache.size', 1024, { cacheType: 'balance' });
   * ```
   */
  gauge(name: string, value: number, tags: MetricData = {}): void {
    if (!this.enabled) return;

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[METRIC] Gauge: ${name} = ${value}`, tags);
    }

    // In production: prometheusClient.gauge(name, value, tags);
  }

  /**
   * Record a histogram value (for distributions)
   * Use for: measuring durations, request sizes, response times
   *
   * @example
   * ```ts
   * this.metricsService.histogram('api.request.duration', 123.45, { endpoint: '/balance' });
   * this.metricsService.histogram('webhook.processing.duration', 456.78, { type: 'balance_update' });
   * ```
   */
  histogram(name: string, value: number, tags: MetricData = {}): void {
    if (!this.enabled) return;

    if (process.env.NODE_ENV === 'development') {
      console.debug(`[METRIC] Histogram: ${name} = ${value}`, tags);
    }

    // In production: prometheusClient.histogram(name, value, tags);
  }

  /**
   * Start a timer for measuring operation duration
   * Returns a function to call when the operation completes
   *
   * @example
   * ```ts
   * const endTimer = this.metricsService.startTimer('api.fetch_balance');
   * try {
   *   const result = await this.fetchBalance();
   *   endTimer({ success: true });
   *   return result;
   * } catch (error) {
   *   endTimer({ success: false, error: error.message });
   *   throw error;
   * }
   * ```
   */
  startTimer(metricName: string): (tags?: MetricData) => void {
    const startTime = Date.now();

    return (tags: MetricData = {}) => {
      const duration = Date.now() - startTime;
      this.histogram(`${metricName}.duration`, duration, tags);
    };
  }

  /**
   * Time an async operation
   *
   * @example
   * ```ts
   * const result = await this.metricsService.time(
   *   'balance.fetch',
   *   () => this.balanceService.getBalance(address),
   *   { address }
   * );
   * ```
   */
  async time<T>(
    metricName: string,
    operation: () => Promise<T>,
    tags: MetricData = {},
  ): Promise<T> {
    const endTimer = this.startTimer(metricName);
    try {
      const result = await operation();
      endTimer({ ...tags, success: true });
      return result;
    } catch (error) {
      endTimer({ ...tags, success: false });
      throw error;
    }
  }
}
