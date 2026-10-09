const { Server } = require('socket.io');
const eventBus = require('../events/eventBus');
const { verifyAccessToken } = require('../config/auth');

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    // Client can authenticate if staff
    socket.on('auth', (token) => {
      const decoded = verifyAccessToken(token);
      if (decoded && ['owner', 'manager', 'barista', 'cashier'].includes(decoded.role)) {
        socket.join('barista');
        socket.emit('auth:success', { role: decoded.role });
      }
    });

    // Customer can join room for their specific order tracking
    socket.on('subscribe:order', (orderId) => {
      if (orderId) {
        socket.join(`order_${orderId}`);
      }
    });

    socket.on('disconnect', () => {
      // clean up
    });
  });

  // Hubungkan eventBus ke Socket.io
  eventBus.subscribe('OrderSubmitted', (event) => {
    // Kirim order baru ke dashboard barista
    io.to('barista').emit('order:new', event.payload.order);
    // Broadcast update nomor antrean ke semua pelanggan
    io.emit('queue:update', {
      lastQueue: event.payload.order?.queue_number,
      type: 'new_order',
    });
  });

  eventBus.subscribe('OrderStatusChanged', (event) => {
    const { id, queue_number, status } = event.payload;
    // Update ke dashboard barista
    io.to('barista').emit('order:status', { id, queue_number, status });
    // Update ke customer yang sedang memantau order ini
    io.to(`order_${id}`).emit('order:tracking', { id, queue_number, status });
    // Broadcast update status antrean live (misal yang sedang diproses)
    io.emit('queue:update', { id, queue_number, status });
  });

  eventBus.subscribe('OrderReady', (event) => {
    const { id, queue_number } = event.payload;
    io.to(`order_${id}`).emit('order:ready', { id, queue_number });
    io.to('barista').emit('order:ready', { id, queue_number });
  });

  eventBus.subscribe('CatalogUpdated', (event) => {
    io.emit('catalog:updates', event.payload);
  });

  eventBus.subscribe('StockLowAlert', (event) => {
    io.to('barista').emit('stock:low', event.payload);
  });

  eventBus.subscribe('StockDecremented', (event) => {
    io.to('barista').emit('stock:decremented', event.payload);
  });

  eventBus.subscribe('JournalPosted', (event) => {
    io.to('barista').emit('journal:posted', { id: event.aggregateId });
  });

  eventBus.subscribe('ReminderSent', (event) => {
    io.to('barista').emit('reminder:sent', event.payload);
  });

  eventBus.subscribe('ReservationCreated', (event) => {
    io.to('barista').emit('reservation:new', event.payload);
  });

  eventBus.subscribe('ReservationSeated', (event) => {
    io.to('barista').emit('reservation:seated', event.payload);
  });

  eventBus.subscribe('ReservationUpdated', (event) => {
    io.to('barista').emit('reservation:updated', event.payload);
  });

  console.log('[WebSocket] Socket.io Gateway initialized');
  return io;
}

function getIO() {
  if (!io) {
    throw new Error('Socket.io has not been initialized');
  }
  return io;
}

module.exports = { initSocket, getIO };
