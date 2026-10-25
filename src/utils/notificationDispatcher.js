const Notification = require('../models/Notification');
const User = require('../models/User');
const { notifyClientNewQuote, notifySellerQuoteAccepted } = require('./socket');

// Firebase Admin integration for push notifications
const path = require('path');
const fs = require('fs');

let admin = null;
try {
  let serviceAccount = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    // Check root of server directory for service account JSON
    const serverDir = path.join(__dirname, '../../');
    const directFile = path.join(serverDir, 'enpanne-9ae01-firebase-adminsdk-fbsvc-bdaa7913c5.json');
    if (fs.existsSync(directFile)) {
      serviceAccount = require(directFile);
    } else {
      const candidates = [
        path.join(serverDir, 'serviceAccountKey.json'),
        path.join(__dirname, '../config/serviceAccountKey.json')
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          serviceAccount = require(p);
          break;
        }
      }
      if (!serviceAccount && fs.existsSync(serverDir)) {
        const files = fs.readdirSync(serverDir);
        const f = files.find(file => file.includes('firebase-adminsdk') && file.endsWith('.json'));
        if (f) {
          serviceAccount = require(path.join(serverDir, f));
        }
      }
    }
  }

  if (serviceAccount) {
    admin = require('firebase-admin');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('[Push Notification] Firebase Admin SDK initialized successfully');
  } else {
    console.log('[Push Notification] Firebase Admin waiting for serviceAccountKey.json or FIREBASE_SERVICE_ACCOUNT env');
  }
} catch (e) {
  console.log('[Push Notification] Firebase Admin optional init notice:', e.message);
}

/**
 * Dispatch Push Notification to device via FCM token
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken || !admin) return false;
  try {
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = String(value);
    }

    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title,
        body
      },
      data: stringifiedData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'enpanne_alerts',
          priority: 'max'
        }
      }
    });
    console.log(`[Push Notification] FCM sent to token: ${fcmToken.slice(0, 15)}...`);
    return true;
  } catch (err) {
    console.error('[Push Notification Error]:', err.message);
    return false;
  }
}

/**
 * Notify Client that a new quote has been received
 */
async function notifyNewQuote({ recipientId, senderId, sellerName, partName, price, partRequestId, quoteId }) {
  try {
    const title = 'عرض سعر جديد على طلبك! 🚗';
    const message = `قدّم ${sellerName} عرض سعر بقيمة ${price} دج لقطعة "${partName}". اضغط للاطلاع على التفاصيل.`;

    // 1. Save in MongoDB
    const notification = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      type: 'quote_received',
      title,
      message,
      data: {
        partRequestId: String(partRequestId),
        quoteId: String(quoteId),
        partName,
        price
      }
    });

    // 2. Dispatch real-time Socket.io event
    notifyClientNewQuote(recipientId, {
      partRequestId: String(partRequestId),
      quoteId: String(quoteId),
      sellerName,
      price,
      notificationId: notification._id
    });

    // 3. Dispatch outside-the-app Push Notification
    const recipient = await User.findById(recipientId).select('fcmToken');
    if (recipient && recipient.fcmToken) {
      await sendPushNotification(recipient.fcmToken, title, message, {
        type: 'quote_received',
        partRequestId: String(partRequestId),
        quoteId: String(quoteId)
      });
    }

    return notification;
  } catch (e) {
    console.error('[Notification Dispatcher Error]:', e.message);
  }
}

/**
 * Notify Seller that their quote has been accepted
 */
async function notifyQuoteAccepted({ sellerId, clientId, clientName, clientPhone, partName, price, partRequestId, quoteId }) {
  try {
    const title = 'تهانينا! تم قبول عرضك 🎉';
    const message = `قام الزبون ${clientName} بقبول عرضك لقطعة "${partName}" بقيمة ${price} دج. يرجى التواصل معه لتسليم القطعة.`;

    // 1. Save in MongoDB
    const notification = await Notification.create({
      recipient: sellerId,
      sender: clientId,
      type: 'quote_accepted',
      title,
      message,
      data: {
        partRequestId: String(partRequestId),
        quoteId: String(quoteId),
        partName,
        price,
        clientPhone
      }
    });

    // 2. Dispatch real-time Socket.io event
    notifySellerQuoteAccepted(sellerId, {
      partRequestId: String(partRequestId),
      quoteId: String(quoteId),
      clientName,
      clientPhone,
      price,
      partName,
      notificationId: notification._id
    });

    // 3. Dispatch outside-the-app Push Notification
    const seller = await User.findById(sellerId).select('fcmToken');
    if (seller && seller.fcmToken) {
      await sendPushNotification(seller.fcmToken, title, message, {
        type: 'quote_accepted',
        partRequestId: String(partRequestId),
        quoteId: String(quoteId)
      });
    }

    return notification;
  } catch (e) {
    console.error('[Notification Dispatcher Error]:', e.message);
  }
}

/**
 * Broadcast Phone Push Notification ONLY to Spare Parts Sellers
 * (WITHOUT saving to MongoDB database, as per user requirement)
 */
async function notifySellersNewPartRequestPushOnly({ requestId, partName, carBrand, carModel, carYear, address, clientLocation }) {
  if (!admin) return;
  try {
    const query = {
      role: 'seller',
      isActive: { $ne: false },
      fcmToken: { $exists: true, $ne: null }
    };

    const sellers = await User.find(query).select('fcmToken brandsSupported');
    if (!sellers || sellers.length === 0) return;

    const title = 'طلب قطعة غيار جديد! 🔧';
    const vehicleText = [carBrand, carModel, carYear].filter(Boolean).join(' ');
    const body = vehicleText 
      ? `طلب جديد لقطعة "${partName}" لسيارة ${vehicleText}. اضغط لتقديم عرضك.`
      : `طلب جديد لقطعة "${partName}". اضغط لتقديم عرضك.`;

    const tokensToSend = [];
    for (const seller of sellers) {
      if (!seller.fcmToken) continue;
      // Filter by brands supported if specified by seller
      if (seller.brandsSupported && seller.brandsSupported.length > 0 && carBrand) {
        const matchesBrand = seller.brandsSupported.some(b => 
          b.toLowerCase().trim() === carBrand.toLowerCase().trim() ||
          carBrand.toLowerCase().includes(b.toLowerCase().trim())
        );
        if (!matchesBrand) continue;
      }
      tokensToSend.push(seller.fcmToken);
    }

    if (tokensToSend.length === 0) return;

    console.log(`[Push Notification] Dispatching push-only alert to ${tokensToSend.length} spare parts sellers...`);

    await admin.messaging().sendEachForMulticast({
      tokens: tokensToSend,
      notification: {
        title,
        body
      },
      data: {
        type: 'new_part_request',
        requestId: String(requestId),
        partName: String(partName || ''),
        carBrand: String(carBrand || ''),
        carModel: String(carModel || '')
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'enpanne_alerts',
          priority: 'max'
        }
      }
    });

    console.log(`[Push Notification] Successfully dispatched push-only alert to sellers for request ${requestId}`);
  } catch (err) {
    console.error('[Push Notification Sellers Error]:', err.message);
  }
}

module.exports = {
  notifyNewQuote,
  notifyQuoteAccepted,
  notifySellersNewPartRequestPushOnly,
  sendPushNotification
};

