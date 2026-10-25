const crypto = require('crypto');
const https = require('https');
const path = require('path');

const R2_CONFIG = {
  accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID || 'a09b48f3a5ef848b5aff17deb463adf4',
  accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '422f7d100ab82c5e94e0f88215df2edd',
  secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '45829f09de21873ba492aefabf6af676dc106b0fc493b17522a08f266ac56378',
  bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME || 'enpanne',
  s3Api: process.env.CLOUDFLARE_R2_S3_API || 'https://a09b48f3a5ef848b5aff17deb463adf4.r2.cloudflarestorage.com',
  publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d5e3f9ffa6294f09a78260068450f659.r2.dev'
};

function hmac(key, string, encoding) {
  return crypto.createHmac('sha256', key).update(string, 'utf8').digest(encoding);
}

function sha256(string, encoding = 'hex') {
  return crypto.createHash('sha256').update(string, 'utf8').digest(encoding);
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Generates an AWS Signature Version 4 Presigned PUT URL for direct frontend upload to Cloudflare R2
 * @param {string} fileKey - Object key path inside the bucket (e.g. "requests/req-12345.jpg")
 * @param {string} contentType - MIME type of the file (e.g. "image/jpeg")
 * @param {number} expiresInSeconds - Lifetime of presigned URL (default 3600 = 1 hour)
 * @returns {object} { uploadUrl, publicUrl, fileKey }
 */
function generatePresignedPutUrl(fileKey, contentType = 'image/jpeg', expiresInSeconds = 3600) {
  const host = `${R2_CONFIG.accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.substring(0, 8);

  // Canonical URI: path to the object
  const cleanKey = fileKey.startsWith('/') ? fileKey.substring(1) : fileKey;
  const canonicalUri = `/${R2_CONFIG.bucketName}/${cleanKey}`;

  // Query parameters in alphabetical order
  const queryParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${R2_CONFIG.accessKeyId}/${dateStamp}/${region}/${service}/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresInSeconds.toString(),
    'X-Amz-SignedHeaders': 'host'
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join('\n');

  const signingKey = getSigningKey(R2_CONFIG.secretAccessKey, dateStamp, region, service);
  const signature = hmac(signingKey, stringToSign, 'hex');

  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  const publicBase = R2_CONFIG.publicUrl.replace(/\/+$/, '');
  const publicUrl = `${publicBase}/${cleanKey}`;

  return {
    uploadUrl,
    publicUrl,
    fileKey: cleanKey
  };
}

/**
 * Direct upload of a buffer to Cloudflare R2 from backend (Fallback option)
 * @param {Buffer} buffer - File buffer
 * @param {string} fileKey - Key to store in R2
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} - Resolves with the public URL
 */
function uploadBufferToR2(buffer, fileKey, contentType = 'image/jpeg') {
  return new Promise((resolve, reject) => {
    const host = `${R2_CONFIG.accountId}.r2.cloudflarestorage.com`;
    const cleanKey = fileKey.startsWith('/') ? fileKey.substring(1) : fileKey;
    const path = `/${R2_CONFIG.bucketName}/${cleanKey}`;
    const region = 'auto';
    const service = 's3';

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const canonicalHeaders = [
      `content-length:${buffer.length}`,
      `content-type:${contentType}`,
      `host:${host}`,
      `x-amz-content-sha256:${contentHash}`,
      `x-amz-date:${amzDate}`
    ].join('\n') + '\n';

    const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      'PUT',
      path,
      '',
      canonicalHeaders,
      signedHeaders,
      contentHash
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256(canonicalRequest)
    ].join('\n');

    const signingKey = getSigningKey(R2_CONFIG.secretAccessKey, dateStamp, region, service);
    const signature = hmac(signingKey, stringToSign, 'hex');

    const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${R2_CONFIG.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const options = {
      hostname: host,
      port: 443,
      path: path,
      method: 'PUT',
      headers: {
        'Host': host,
        'Content-Type': contentType,
        'Content-Length': buffer.length,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': contentHash,
        'Authorization': authorizationHeader
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const publicBase = R2_CONFIG.publicUrl.replace(/\/+$/, '');
        resolve(`${publicBase}/${cleanKey}`);
      } else {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          reject(new Error(`Cloudflare R2 returned status ${res.statusCode}: ${body}`));
        });
      }
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(buffer);
    req.end();
  });
}

module.exports = {
  R2_CONFIG,
  generatePresignedPutUrl,
  uploadBufferToR2
};
