import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);

  const httpServer = app.getHttpAdapter().getInstance();
  httpServer.get('/reset-password', (req: any, res: any) => {
    const token = String(req.query?.token || '');
    const escapedToken = token.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reset Password</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #0b1020; color: #e8eaf2; margin: 0; }
      .wrap { max-width: 520px; margin: 0 auto; padding: 48px 16px; }
      .card { background: #111a33; border: 1px solid #26325a; border-radius: 14px; padding: 24px; }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 18px; color: #b8c0de; }
      label { display: block; font-weight: 600; margin: 12px 0 6px; }
      input { width: 100%; padding: 12px 12px; border-radius: 10px; border: 1px solid #2a3865; background: #0b1020; color: #e8eaf2; }
      button { width: 100%; margin-top: 16px; padding: 12px 14px; border-radius: 10px; border: 0; background: #6a5cff; color: white; font-weight: 700; cursor: pointer; }
      button:disabled { opacity: 0.6; cursor: not-allowed; }
      .msg { margin-top: 14px; padding: 12px; border-radius: 10px; display: none; }
      .msg.ok { background: rgba(46, 204, 113, 0.14); border: 1px solid rgba(46, 204, 113, 0.35); display: block; }
      .msg.err { background: rgba(231, 76, 60, 0.14); border: 1px solid rgba(231, 76, 60, 0.35); display: block; }
      .small { font-size: 12px; color: #98a3cf; margin-top: 10px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Reset your password</h1>
        <p>Choose a new password for your account.</p>
        <form id="form">
          <input type="hidden" id="token" value="${escapedToken}" />
          <label for="password">New password</label>
          <input id="password" type="password" autocomplete="new-password" required minlength="6" />
          <label for="confirm">Confirm password</label>
          <input id="confirm" type="password" autocomplete="new-password" required minlength="6" />
          <button id="btn" type="submit">Update password</button>
          <div id="msg" class="msg"></div>
          <div class="small">If this page was opened without a token, request a new password reset email.</div>
        </form>
      </div>
    </div>
    <script>
      const form = document.getElementById('form');
      const msg = document.getElementById('msg');
      const btn = document.getElementById('btn');
      const tokenEl = document.getElementById('token');
      const passwordEl = document.getElementById('password');
      const confirmEl = document.getElementById('confirm');

      function setMsg(type, text) {
        msg.className = 'msg ' + type;
        msg.textContent = text;
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const token = tokenEl.value || '';
        const password = passwordEl.value || '';
        const confirm = confirmEl.value || '';
        if (!token) {
          setMsg('err', 'Missing reset token. Please request a new reset email.');
          return;
        }
        if (password.length < 6) {
          setMsg('err', 'Password must be at least 6 characters.');
          return;
        }
        if (password !== confirm) {
          setMsg('err', 'Passwords do not match.');
          return;
        }

        btn.disabled = true;
        setMsg('ok', 'Updating password...');
        try {
          const resp = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword: password })
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            setMsg('err', data?.message || 'Failed to reset password.');
            return;
          }
          setMsg('ok', data?.message || 'Password reset successful. You can now sign in.');
          passwordEl.value = '';
          confirmEl.value = '';
        } catch (err) {
          setMsg('err', 'Network error. Please try again.');
        } finally {
          btn.disabled = false;
        }
      });
    </script>
  </body>
</html>`);
  });

  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
  }));

  const swaggerConfig = new DocumentBuilder()
    .setTitle(configService.get<string>('swagger.title') || 'GameForge API')
    .setDescription(configService.get<string>('swagger.description') || 'GameForge AI - Game creation platform with AI')
    .setVersion(configService.get<string>('swagger.version') || '1.0')
    .addBearerAuth()
    .addTag('Authentication')
    .addTag('Users')
    .build();
  
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'GameForge API Documentation',
    customfavIcon: '/favicon.ico',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #1890ff; }
      .swagger-ui .scheme-container { background: #f5f5f5; }
    `,
  });

  const port = configService.get<number>('port') || 3000;
  
  console.log('🚀 GameForge Backend Server');
  console.log(`📱 Server running on: http://localhost:${port}`);
  console.log(`📚 Swagger documentation: http://localhost:${port}/api/docs`);
  console.log('');
  console.log('🔐 Authentication endpoints:');
  console.log('  POST /api/auth/register - Register new user');
  console.log('  POST /api/auth/login - User login');
  console.log('  POST /api/auth/logout - User logout');
  console.log('  POST /api/auth/refresh-token - Refresh access token');
  console.log('  POST /api/auth/forgot-password - Forgot password');
  console.log('  POST /api/auth/reset-password - Reset password');
  console.log('  GET  /api/auth/verify-email/:token - Verify email');
  console.log('');
  console.log('👤 User endpoints:');
  console.log('  GET  /api/users/me - Get user profile (protected)');
  console.log('  PATCH /api/users/me - Update user profile (protected)');
  console.log('  DELETE /api/users/me - Delete user account (protected)');

  await app.listen(port);
}
bootstrap();
