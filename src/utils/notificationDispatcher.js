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
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    if (raw.startsWith('{')) {
      serviceAccount = JSON.parse(raw);
    } else {
      try {
        const decoded = Buffer.from(raw, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
      } catch {
        serviceAccount = JSON.parse(raw);
      }
    }
  }

  if (!serviceAccount) {
    const serverDir = path.join(__dirname, '../../');
    const candidates = [
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
      '/etc/secrets/enpanne-9ae01-firebase-adminsdk-fbsvc-bdaa7913c5.json',
      '/etc/secrets/serviceAccountKey.json',
      path.join(serverDir, 'enpanne-9ae01-firebase-adminsdk-fbsvc-bdaa7913c5.json'),
      path.join(serverDir, 'serviceAccountKey.json'),
      path.join(__dirname, '../config/serviceAccountKey.json')
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          serviceAccount = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        } catch (err) {
          console.error('[Push Notification] Error reading serviceAccount from', p, err.message);
        }
      }
    }

    // Check /etc/secrets directory on Render
    if (!serviceAccount && fs.existsSync('/etc/secrets')) {
      try {
        const secretFiles = fs.readdirSync('/etc/secrets');
        const sf = secretFiles.find(file => file.endsWith('.json'));
        if (sf) {
          serviceAccount = JSON.parse(fs.readFileSync(path.join('/etc/secrets', sf), 'utf8'));
        }
      } catch {}
    }

    // Check root of server directory
    if (!serviceAccount && fs.existsSync(serverDir)) {
      try {
        const files = fs.readdirSync(serverDir);
        const f = files.find(file => file.includes('firebase-adminsdk') && file.endsWith('.json'));
        if (f) {
          serviceAccount = JSON.parse(fs.readFileSync(path.join(serverDir, f), 'utf8'));
        }
      } catch {}
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
  if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim().length < 10) {
    console.warn('[Push Notification] Invalid or empty FCM token, skipping push.');
    return false;
  }
  if (!admin) {
    console.warn('[Push Notification] Firebase Admin NOT initialized. Please set FIREBASE_SERVICE_ACCOUNT environment variable on Render.');
    return false;
  }
  try {
    const stringifiedData = {};
    for (const [key, value] of Object.entries(data)) {
      stringifiedData[key] = String(value);
    }

    const response = await admin.messaging().send({
      token: fcmToken.trim(),
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
    console.log(`[Push Notification] FCM push sent successfully to token: ${fcmToken.slice(0, 15)}... (msgId: ${response})`);
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
  if (!admin) {
    console.warn('[Push Notification] Firebase Admin NOT initialized. Please set FIREBASE_SERVICE_ACCOUNT on Render to alert sellers on phone.');
    return;
  }
  try {
    const query = {
      role: 'seller',
      isActive: { $ne: false },
      fcmToken: { $exists: true, $ne: null, $nin: ['', 'null', 'undefined'] }
    };

    const sellers = await User.find(query).select('fcmToken brandsSupported');
    if (!sellers || sellers.length === 0) {
      console.log('[Push Notification] No active sellers with registered FCM tokens found.');
      return;
    }

    const title = 'طلب قطعة غيار جديد! 🔧';
    const vehicleText = [carBrand, carModel, carYear].filter(Boolean).join(' ');
    const body = vehicleText 
      ? `طلب جديد لقطعة "${partName}" لسيارة ${vehicleText}. اضغط لتقديم عرضك.`
      : `طلب جديد لقطعة "${partName}". اضغط لتقديم عرضك.`;

    const tokensToSend = [];
    for (const seller of sellers) {
      if (!seller.fcmToken || typeof seller.fcmToken !== 'string' || seller.fcmToken.trim().length < 10) continue;
      
      // Filter by brands supported if specified by seller
      if (seller.brandsSupported && seller.brandsSupported.length > 0 && carBrand) {
        const isGeneral = seller.brandsSupported.some(b => 
          ['الكل', 'tous', 'toutes', 'all', 'كل السيارات', 'جميع الماركات', 'toutes les marques'].includes(b.toLowerCase().trim())
        );
        if (!isGeneral) {
          const reqBrandClean = carBrand.toLowerCase().trim();
          const matchesBrand = seller.brandsSupported.some(b => {
            const bClean = b.toLowerCase().trim();
            return bClean === reqBrandClean ||
                   reqBrandClean.includes(bClean) ||
                   bClean.includes(reqBrandClean);
          });
          if (!matchesBrand) {
            console.log(`[Push Notification] Seller ${seller._id} skipped for request brand '${carBrand}'`);
            continue;
          }
        }
      }
      tokensToSend.push(seller.fcmToken.trim());
    }

    if (tokensToSend.length === 0) {
      console.log('[Push Notification] No seller tokens matched request criteria.');
      return;
    }

    console.log(`[Push Notification] Dispatching push-only alert to ${tokensToSend.length} spare parts sellers...`);

    const result = await admin.messaging().sendEachForMulticast({
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

    console.log(`[Push Notification] Dispatched to sellers: ${result.successCount} succeeded, ${result.failureCount} failed.`);
    if (result.failureCount > 0) {
      result.responses.forEach((r, idx) => {
        if (!r.success) {
          console.error(`[Push Notification] Error sending to seller token ${tokensToSend[idx].slice(0, 10)}...:`, r.error?.message);
        }
      });
    }
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

