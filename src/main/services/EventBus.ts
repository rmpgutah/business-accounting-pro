// src/main/services/EventBus.ts
// In-process semantic event bus for cross-module workflows.
// Modules emit events; subscribers (workflows, audit log, intelligence) react.

import * as db from '../database';
import { v4 as uuid } from 'uuid';

export type EventType =
  // Invoice
  | 'invoice.created' | 'invoice.updated' | 'invoice.deleted'
  | 'invoice.sent' | 'invoice.viewed' | 'invoice.paid'
  | 'invoice.partial_paid' | 'invoice.overdue' | 'invoice.voided'
  // Expense
  | 'expense.created' | 'expense.updated' | 'expense.approved'
  | 'expense.rejected' | 'expense.reimbursed'
  // Payment
  | 'payment.received' | 'payment.refunded'
  // Client / Vendor
  | 'client.created' | 'client.updated' | 'client.status_changed'
  | 'vendor.created' | 'vendor.updated'
  // Quote
  | 'quote.created' | 'quote.sent' | 'quote.accepted'
  | 'quote.rejected' | 'quote.converted' | 'quote.expired'
  // Debt
  | 'debt.created' | 'debt.escalated' | 'debt.payment_received'
  | 'debt.settled' | 'debt.closed' | 'debt.written_off'
  // Payroll
  | 'payroll.processed' | 'payroll.paid'
  // Project
  | 'project.created' | 'project.budget_warning' | 'project.completed'
  // Tax
  | 'tax.filing_due' | 'tax.deposit_due'
  // Generic
  | 'entity.deleted';

export interface EventPayload {
  type: EventType;
  companyId: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, any>;
  occurredAt?: string;
}

type Listener = (payload: EventPayload) => void | Promise<void>;

class EventBus {
  private listeners: Map<EventType, Set<Listener>> = new Map();
  private wildcardListeners: Set<Listener> = new Set();

  on(type: EventType, listener: Listener): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.listeners.get(type)?.delete(listener);
  }

  onAny(listener: Listener): () => void {
    this.wildcardListeners.add(listener);
    return () => this.wildcardListeners.delete(listener);
  }

  async emit(payload: EventPayload): Promise<void> {
    const enriched: EventPayload = {
      ...payload,
      occurredAt: payload.occurredAt || new Date().toISOString(),
    };

    // PERSIST: log to workflow_event_log for audit + replay
    try {
      const dbI = db.getDb();
      dbI.prepare(
        `INSERT INTO workflow_event_log (id, company_id, event_type, entity_type, entity_id, payload_json, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uuid(),
        enriched.companyId,
        enriched.type,
        enriched.entityType || '',
        enriched.entityId || '',
        JSON.stringify(enriched.data || {}),
        enriched.occurredAt!
      );
    } catch (err) {
      console.warn('[EventBus] Failed to log event:', err);
    }

    // FAN OUT: typed listeners + wildcard listeners
    const typed = this.listeners.get(enriched.type) || new Set();
    const all = [...typed, ...this.wildcardListeners];
    for (const fn of all) {
      try {
        await Promise.resolve(fn(enriched));
      } catch (err) {
        console.warn(`[EventBus] Listener error for ${enriched.type}:`, err);
      }
    }
  }
}

// Singleton
export const eventBus = new EventBus();
