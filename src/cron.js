const cron = require('cron');
const https = require('https');

const pingUrl =
  process.env.API_URL ||
  process.env.BASE_URL ||
  'https://zbibfahimserver.onrender.com';

const job = new cron.CronJob('*/14 * * * *', function () {
  try {
    const target = pingUrl.endsWith('/api/health')
      ? pingUrl
      : `${pingUrl.replace(/\/+$/, '')}/api/health`;

    https
      .get(target, (res) => {
        if (res.statusCode === 200) {
          console.log('[Cron] Keep-alive ping sent successfully (200)');
        } else {
          console.log('[Cron] Keep-alive ping status:', res.statusCode);
        }
      })
      .on('error', (e) => {
        console.error('[Cron] Keep-alive error:', e.message);
      });
  } catch (err) {
    console.error('[Cron] Keep-alive exception:', err.message);
  }
});

module.exports = job;