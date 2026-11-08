const twilio = require('twilio');

/**
 * Format phone number to E.164 format.
 * Algerian numbers (05xx, 06xx, 07xx) are mapped to +2135xx, +2136xx, +2137xx.
 */
function formatPhoneToE164(phone) {
  if (!phone) return '';
  let cleaned = String(phone).trim().replace(/[\s\-\(\)]/g, '');

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
  }

  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Algerian mobile format: 10 digits starting with 0 (e.g. 0550123456, 0661123456, 0770123456)
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return '+213' + cleaned.substring(1);
  }

  // 9 digits starting with 5, 6, 7 (e.g. 550123456)
  if (cleaned.length === 9 && ['5', '6', '7'].includes(cleaned.charAt(0))) {
    return '+213' + cleaned;
  }

  return '+' + cleaned;
}

/**
 * Initialize Twilio Client if credentials are provided in env.
 */
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (accountSid && authToken && accountSid.startsWith('AC')) {
    try {
      return twilio(accountSid, authToken);
    } catch (err) {
      console.warn('[Twilio] Failed to initialize client:', err.message);
      return null;
    }
  }
  return null;
}

/**
 * Send WhatsApp OTP via Twilio
 * @param {string} phone - Target phone number
 * @param {string} otp - 6-digit verification code
 * @returns {Promise<{success: boolean, sid?: string, formattedPhone: string, simulated?: boolean, error?: string}>}
 */
async function sendWhatsAppOtp(phone, otp) {
  const formattedPhone = formatPhoneToE164(phone);
  const client = getTwilioClient();

  // WhatsApp sender number (Twilio Sandbox default: whatsapp:+14155238886)
  let fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886';
  if (!fromNumber.startsWith('whatsapp:')) {
    fromNumber = `whatsapp:${fromNumber}`;
  }

  const toNumber = `whatsapp:${formattedPhone}`;
  const messageBody = `رمز التحقق الخاص بك في تطبيق En Panne هو: ${otp}\nVotre code de vérification En Panne est : ${otp}\n(صالح لمدة 5 دقائق)`;

  if (!client) {
    console.log('===================================================');
    console.log(`[Twilio WhatsApp OTP] (Development / Mock Mode)`);
    console.log(`To: ${toNumber}`);
    console.log(`OTP Code: ${otp}`);
    console.log(`Body:\n${messageBody}`);
    console.log('===================================================');
    return {
      success: true,
      simulated: true,
      formattedPhone,
      otp: process.env.NODE_ENV !== 'production' ? otp : undefined
    };
  }

  try {
    const msg = await client.messages.create({
      from: fromNumber,
      to: toNumber,
      body: messageBody
    });

    console.log(`[Twilio WhatsApp] OTP message sent to ${toNumber}, SID: ${msg.sid}`);
    return {
      success: true,
      sid: msg.sid,
      formattedPhone
    };
  } catch (err) {
    console.error(`[Twilio WhatsApp Error] Failed sending to ${toNumber}:`, err.message);

    // If sandbox error or dev environment, fallback so developers are not blocked
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Twilio WhatsApp Fallback] Development OTP for ${formattedPhone}: ${otp}`);
      return {
        success: true,
        simulated: true,
        formattedPhone,
        otp,
        warning: err.message
      };
    }

    return {
      success: false,
      formattedPhone,
      error: err.message
    };
  }
}

module.exports = {
  formatPhoneToE164,
  sendWhatsAppOtp
};

