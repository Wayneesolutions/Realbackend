const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET;
const REGION = process.env.AWS_REGION;

async function generatePresignedUploadUrl(originalFilename, contentType) {
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    throw Object.assign(new Error('Only JPEG, PNG, WebP, and GIF images are allowed.'), { code: 'INVALID_FILE_TYPE' });
  }

  const ext = originalFilename.split('.').pop().toLowerCase();
  const key = `ads/${uuidv4()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
  const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

  return { presignedUrl, publicUrl, key };
}

module.exports = { generatePresignedUploadUrl, MAX_FILE_SIZE, ALLOWED_MIME_TYPES };
