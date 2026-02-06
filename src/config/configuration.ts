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
  
  api: {
    prefix: process.env.API_PREFIX || 'api/v1',
  },
  
  swagger: {
    title: process.env.SWAGGER_TITLE || 'GameForge API',
    description: process.env.SWAGGER_DESCRIPTION || 'GameForge AI - Game creation platform with AI',
    version: process.env.SWAGGER_VERSION || '1.0',
  },
});
