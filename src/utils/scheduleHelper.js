/**
 * Helper to compute shop/provider open and closed status
 * based on weekly schedule, working hours, 24/7 mode, and manual closure overrides.
 */

/**
 * Parses time string (e.g. "08:30") to minutes from midnight
 * @param {string} timeStr 
 * @param {number} defaultMinutes 
 * @returns {number}
 */
function parseTimeToMinutes(timeStr, defaultMinutes = 0) {
  if (!timeStr || typeof timeStr !== 'string') return defaultMinutes;
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return defaultMinutes;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return defaultMinutes;
  return h * 60 + m;
}

/**
 * Compute shop open/closed status
 * @param {Object} user - User document or plain object
 * @param {Date} [date] - Evaluation date (defaults to now)
 * @returns {{
 *   isOpen: boolean,
 *   reason: string,
 *   statusTextAr: string,
 *   statusTextFr: string
 * }}
 */
function computeShopOpenStatus(user, date = new Date()) {
  if (!user) {
    return {
      isOpen: false,
      reason: 'unknown',
      statusTextAr: 'مغلق',
      statusTextFr: 'Fermé'
    };
  }

  // 1. Emergency / Special Circumstances Manual Closure (زر الإغلاق)
  if (user.isTemporarilyClosed === true) {
    return {
      isOpen: false,
      reason: 'temporarily_closed',
      statusTextAr: 'مغلق مؤقتاً لظروف خاصة',
      statusTextFr: 'Fermé temporairement'
    };
  }

  // 2. Round-the-clock 24/7 (على مدار الساعة)
  if (user.is24_7 === true) {
    return {
      isOpen: true,
      reason: 'open_24_7',
      statusTextAr: 'مفتوح 24/7',
      statusTextFr: 'Ouvert 24h/24'
    };
  }

  // 3. Weekly Schedule Check (أيام العمل)
  // JS getDay(): 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
  const currentDay = date.getDay();
  const workingDays = Array.isArray(user.workingDays) && user.workingDays.length > 0
    ? user.workingDays.map(Number)
    : [6, 0, 1, 2, 3, 4]; // Default Algerian schedule: Saturday through Thursday

  if (!workingDays.includes(currentDay)) {
    return {
      isOpen: false,
      reason: 'day_off',
      statusTextAr: 'مغلق اليوم (عطلة)',
      statusTextFr: 'Fermé aujourd\'hui'
    };
  }

  // 4. Working Hours Check (وقت الفتح والإغلاق)
  const openTime = user.openTime || '08:00';
  const closeTime = user.closeTime || '18:00';

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  const openMinutes = parseTimeToMinutes(openTime, 8 * 60);
  const closeMinutes = parseTimeToMinutes(closeTime, 18 * 60);

  if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) {
    return {
      isOpen: true,
      reason: 'open_now',
      statusTextAr: 'مفتوح الآن',
      statusTextFr: 'Ouvert'
    };
  } else {
    return {
      isOpen: false,
      reason: 'outside_hours',
      statusTextAr: `مغلق الآن • يفتح ${openTime}`,
      statusTextFr: `Fermé • Ouvre à ${openTime}`
    };
  }
}

module.exports = {
  computeShopOpenStatus,
  parseTimeToMinutes
};
