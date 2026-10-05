const { EventEmitter } = require('events');
const crypto = require('crypto');

class DomainEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Mengirim event domain berstandar Blueprint v2.0 (Bab 17.3)
   * @param {string} eventType - Contoh: 'OrderSubmitted', 'OrderStatusChanged', 'OrderPaid'
   * @param {string|number} aggregateId - ID entitas terkait
   * @param {object} payload - Isi data event
   * @param {object} [metadata] - Opsional: correlationId, userId, dll
   */
  publish(eventType, aggregateId, payload = {}, metadata = {}) {
    const event = {
      eventId: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      eventType,
      aggregateId: String(aggregateId),
      occurredAt: new Date().toISOString(),
      payload,
      metadata: {
        correlationId: metadata.correlationId || crypto.randomBytes(8).toString('hex'),
        version: '1.0',
        ...metadata,
      },
    };

    console.log(`[EventBus] 📢 ${eventType} (id: ${event.eventId}, agg: ${aggregateId})`);
    
    // Emit spesifik untuk eventType
    this.emit(eventType, event);
    // Emit wildcard untuk audit / logger
    this.emit('*', event);

    return event;
  }

  /**
   * Subscribe ke tipe event tertentu
   */
  subscribe(eventType, handler) {
    this.on(eventType, async (event) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(`[EventBus] ❌ Error handling event ${eventType}:`, err.message);
      }
    });
  }
}

const eventBus = new DomainEventBus();

// Log all events in development
eventBus.on('*', (ev) => {
  if (process.env.DEBUG_EVENTS === 'true') {
    console.log('[EventBus Audit]', JSON.stringify(ev, null, 2));
  }
});

module.exports = eventBus;
