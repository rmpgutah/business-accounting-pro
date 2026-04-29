// Multi-step operations with rollback support.

export interface SagaStep {
  name: string;
  forward: () => Promise<any>;
  rollback: (forwardResult?: any) => Promise<void>;
}

export class Saga {
  private steps: SagaStep[] = [];
  private completed: Array<{ step: SagaStep; result: any }> = [];

  add(step: SagaStep): this {
    this.steps.push(step);
    return this;
  }

  async run(): Promise<{ success: boolean; results: any[]; error?: string }> {
    const results: any[] = [];
    for (const step of this.steps) {
      try {
        const result = await step.forward();
        this.completed.push({ step, result });
        results.push(result);
      } catch (err: any) {
        for (const c of this.completed.reverse()) {
          try { await c.step.rollback(c.result); } catch (rbErr) {
            console.warn(`[Saga] Rollback of ${c.step.name} failed:`, rbErr);
          }
        }
        return { success: false, results, error: err?.message || 'saga failed' };
      }
    }
    return { success: true, results };
  }
}
