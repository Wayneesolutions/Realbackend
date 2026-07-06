const { generatePresignedUploadUrl, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } = require('../services/s3Service');

async function getPresignedUrl(req, res) {
  const { filename, contentType, fileSize } = req.body;

  if (!filename || !contentType) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'filename and contentType are required.' },
    });
  }

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return res.status(400).json({
      error: { code: 'INVALID_FILE_TYPE', message: 'Only JPEG, PNG, WebP, and GIF images are allowed.' },
    });
  }

  if (fileSize && fileSize > MAX_FILE_SIZE) {
    return res.status(400).json({
      error: { code: 'FILE_TOO_LARGE', message: 'File must be under 5MB.' },
    });
  }

  try {
    const { presignedUrl, publicUrl } = await generatePresignedUploadUrl(filename, contentType);
    return res.json({ success: true, presignedUrl, publicUrl });
  } catch (error) {
    console.error('Failed to generate presigned URL:', error.message);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to generate upload URL.' },
    });
  }
}

module.exports = { getPresignedUrl };
