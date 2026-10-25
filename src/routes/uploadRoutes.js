const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { generatePresignedPutUrl, uploadBufferToR2 } = require('../utils/r2Service');

// In-memory storage for buffer upload
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

/**
 * Helper to upload buffer to R2 with automatic local disk fallback
 */
async function processUpload(file, folder, req) {
  const ext = path.extname(file.originalname) || '.jpg';
  const cleanExt = ext && ext.length > 1 ? ext : '.jpg';
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const sanitizedFolder = (folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileKey = `${sanitizedFolder}/img-${uniqueSuffix}${cleanExt}`;

  let publicUrl;
  try {
    publicUrl = await uploadBufferToR2(file.buffer, fileKey, file.mimetype);
  } catch (r2Error) {
    console.warn('[Upload API] R2 upload unavailable, saving locally to /uploads:', r2Error.message);
    const localDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const localFileName = `img-${uniqueSuffix}${cleanExt}`;
    fs.writeFileSync(path.join(localDir, localFileName), file.buffer);

    const baseUrl = process.env.BASE_URL || `http://${req.get('host') || 'localhost:5000'}`;
    publicUrl = `${baseUrl}/uploads/${localFileName}`;
  }

  return { publicUrl, fileKey };
}

/**
 * @desc    Standard image upload endpoint (profile, parts requests, etc.)
 * @route   POST /api/upload
 * @access  Public / Private
 */
router.post('/', memoryUpload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إرفاق ملف للرفع / Aucun fichier fourni'
      });
    }

    const folder = req.body.folder || 'general';
    const { publicUrl, fileKey } = await processUpload(file, folder, req);

    return res.status(200).json({
      success: true,
      message: 'تم رفع الصورة بنجاح / Image téléchargée avec succès',
      url: publicUrl,
      data: {
        url: publicUrl,
        fileKey
      }
    });
  } catch (error) {
    console.error('[Upload API] Error in upload:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'فشل في رفع الملف / Erreur lors du téléchargement'
    });
  }
});

/**
 * @desc    Direct backend upload to Cloudflare R2 (with local disk fallback)
 * @route   POST /api/upload/direct
 * @access  Public / Private
 */
router.post('/direct', memoryUpload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إرفاق ملف للرفع / Aucun fichier fourni'
      });
    }

    const folder = req.body.folder || 'requests';
    const { publicUrl, fileKey } = await processUpload(file, folder, req);

    return res.status(200).json({
      success: true,
      message: 'تم رفع الملف بنجاح',
      url: publicUrl,
      data: {
        url: publicUrl,
        fileKey
      }
    });
  } catch (error) {
    console.error('[Upload API] Error in direct upload:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'فشل في رفع الملف'
    });
  }
});

/**
 * @desc    Get Presigned PUT URL for direct frontend-to-Cloudflare R2 upload
 * @route   POST /api/upload/presigned-url
 * @access  Public / Private
 */
router.post('/presigned-url', (req, res) => {
  try {
    const { fileName, contentType = 'image/jpeg', folder = 'requests' } = req.body;

    const ext = fileName ? path.extname(fileName).toLowerCase() : '.jpg';
    const cleanExt = ext && ext.length > 1 ? ext : '.jpg';
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '');
    const fileKey = `${sanitizedFolder}/img-${uniqueSuffix}${cleanExt}`;

    const { uploadUrl, publicUrl } = generatePresignedPutUrl(fileKey, contentType, 3600);

    return res.status(200).json({
      success: true,
      message: 'Presigned upload URL generated successfully',
      data: {
        uploadUrl,
        publicUrl,
        fileKey
      }
    });
  } catch (error) {
    console.error('[Upload API] Error generating presigned URL:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'فشل في إنشاء رابط الرفع إلى Cloudflare R2'
    });
  }
});

module.exports = router;
