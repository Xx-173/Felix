/** A successful demo/local probe does not imply an external service is connected. */
export interface HealthCheckItem {
  ok: boolean;
  detail: string | null;
  error: { code: string; message: string } | null;
  mode?: 'demo' | 'local';
}

export interface HealthCheckReport {
  ai: HealthCheckItem;
  marketData: HealthCheckItem;
  skills: HealthCheckItem;
  agentRuntime: HealthCheckItem;
}
