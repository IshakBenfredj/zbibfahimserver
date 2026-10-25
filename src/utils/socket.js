const { Server } = require('socket.io');

let io = null;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join user-specific private room for direct notifications
    socket.on('join_user', (userId) => {
      if (userId) {
        socket.join(`user:${userId}`);
        console.log(`[Socket.io] User ${userId} joined room user:${userId}`);
      }
    });

    // Sellers join the general sellers room to get notified of new requests
    socket.on('join_sellers', () => {
      socket.join('sellers');
      console.log(`[Socket.io] Socket ${socket.id} joined 'sellers' broadcast room`);
    });

    // Join a specific spare part request room to watch live incoming quotes
    socket.on('watch_request', (requestId) => {
      if (requestId) {
        socket.join(`request:${requestId}`);
        console.log(`[Socket.io] Socket ${socket.id} watching request:${requestId}`);
      }
    });

    socket.on('leave_request', (requestId) => {
      if (requestId) {
        socket.leave(`request:${requestId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialized yet!');
  }
  return io;
};

// Real-time helper: Notify client of a new confidential quote
const notifyClientNewQuote = (clientId, quotePayload) => {
  if (io) {
    io.to(`user:${clientId}`).emit('new_quote_received', quotePayload);
    // Also notify any watcher on the request room that a new quote arrived (without revealing price to others)
    io.to(`request:${quotePayload.partRequestId}`).emit('quote_count_updated', {
      partRequestId: quotePayload.partRequestId,
      quotesCount: quotePayload.quotesCount
    });
  }
};

// Real-time helper: Notify all spare parts sellers of a newly posted part request
const notifySellersNewRequest = (requestPayload) => {
  if (io) {
    io.to('sellers').emit('new_part_request', requestPayload);
  }
};

// Real-time helper: Notify seller that their quote was accepted
const notifySellerQuoteAccepted = (sellerId, acceptPayload) => {
  if (io) {
    io.to(`user:${sellerId}`).emit('quote_accepted', acceptPayload);
  }
};

module.exports = {
  initSocket,
  getIO,
  notifyClientNewQuote,
  notifySellersNewRequest,
  notifySellerQuoteAccepted
};
