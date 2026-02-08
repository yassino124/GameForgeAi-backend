export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/gameforge',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    rememberMeExpiresIn: process.env.JWT_REMEMBER_ME_EXPIRES_IN || '30d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },

  email: {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: process.env.EMAIL_SECURE === 'true',
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
    avatarFolder: process.env.CLOUDINARY_AVATAR_FOLDER || 'gameforge/avatars',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    apiVersion: process.env.STRIPE_API_VERSION,
    currency: process.env.STRIPE_CURRENCY || 'usd',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    successUrl: process.env.STRIPE_SUCCESS_URL,
    cancelUrl: process.env.STRIPE_CANCEL_URL,
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL,
    connectEnabled: process.env.STRIPE_CONNECT_ENABLED === 'true',
    platformCommissionPercentage: process.env.PLATFORM_COMMISSION_PERCENTAGE
      ? parseFloat(process.env.PLATFORM_COMMISSION_PERCENTAGE)
      : undefined,
  },

  storage: {
    local: {
      baseDir: process.env.LOCAL_ASSETS_DIR,
    },
    templates: {
      baseDir: process.env.LOCAL_TEMPLATES_DIR,
    },
    projects: {
      baseDir: process.env.LOCAL_PROJECTS_DIR,
    },
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
      signedUrlExpiresSeconds: process.env.S3_SIGNED_URL_EXPIRES_SECONDS
        ? parseInt(process.env.S3_SIGNED_URL_EXPIRES_SECONDS, 10)
        : 300,
    },
  },
  
  api: {
    prefix: process.env.API_PREFIX || 'api/v1',
  },
  
  swagger: {
    title: process.env.SWAGGER_TITLE || 'GameForge API',
    description: process.env.SWAGGER_DESCRIPTION || 'GameForge AI - Game creation platform with AI',
    version: process.env.SWAGGER_VERSION || '1.0',
  },
});
