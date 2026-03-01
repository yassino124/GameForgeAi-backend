import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('email.host') || 'smtp.gmail.com';
    const port = this.configService.get<number>('email.port') ?? 587;
    const secureFromConfig = this.configService.get<boolean>('email.secure');
    const secure = typeof secureFromConfig === 'boolean' ? secureFromConfig : port === 465;
    const user = (this.configService.get<string>('email.user') || '').trim();
    const pass = (this.configService.get<string>('email.pass') || '').trim();

    if (!user || !pass) {
      console.warn(
        '[EmailService] SMTP is not configured. Please set EMAIL_USER and EMAIL_PASS in the backend .env',
      );
    }

    console.log('[EmailService] SMTP config', {
      host,
      port,
      secure,
      user,
      passLength: pass.length,
    });

    // Configure le transporteur d'email
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure, // true for 465, false for other ports
      auth: {
        user,
        pass,
      },
    });
  }

  private assertSmtpConfigured() {
    const user = (this.configService.get<string>('email.user') || '').trim();
    const pass = (this.configService.get<string>('email.pass') || '').trim();
    if (!user || !pass) {
      throw new Error(
        'Email SMTP is not configured. Please set EMAIL_USER and EMAIL_PASS in the backend .env',
      );
    }
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    this.assertSmtpConfigured();
    const resetUrl = `${this.configService.get<string>('email.frontendUrl')}/reset-password?token=${resetToken}`;
    
    const mailOptions = {
      from: `"GameForge AI" <${this.configService.get<string>('email.user')}>`,
      to: email,
      subject: '🔐 Reset Your GameForge AI Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="background: #1F2937; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);">
                  <!-- Header with Gradient -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #6366F1 0%, #A78BFA 100%); padding: 40px 30px; text-align: center;">
                      <h1 style="margin: 0; color: #FFFFFF; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">
                        🎮 GameForge AI
                      </h1>
                      <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px; font-weight: 500;">
                        AI-Powered Game Development
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 50px 40px;">
                      <h2 style="margin: 0 0 20px 0; color: #F9FAFB; font-size: 26px; font-weight: 600; text-align: center;">
                        Password Reset Request
                      </h2>
                      
                      <p style="margin: 0 0 24px 0; color: #9CA3AF; font-size: 16px; line-height: 1.6;">
                        Hello,
                      </p>
                      
                      <p style="margin: 0 0 32px 0; color: #9CA3AF; font-size: 16px; line-height: 1.6;">
                        We received a request to reset your GameForge AI password. Click the button below to create a new password:
                      </p>
                      
                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 32px 0;">
                        <tr>
                          <td align="center">
                            <a href="${resetUrl}" 
                               style="display: inline-block; background: linear-gradient(135deg, #6366F1 0%, #A78BFA 100%); 
                                      color: #FFFFFF; text-decoration: none; padding: 16px 48px; border-radius: 12px; 
                                      font-size: 16px; font-weight: 600; box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
                                      transition: all 0.3s ease;">
                              🔓 Reset My Password
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 0 0 16px 0; color: #9CA3AF; font-size: 14px; line-height: 1.6; text-align: center;">
                        Or copy and paste this link into your browser:
                      </p>
                      
                      <p style="margin: 0 0 32px 0; color: #6366F1; font-size: 13px; word-break: break-all; 
                                background: rgba(99, 102, 241, 0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
                        ${resetUrl}
                      </p>
                      
                      <!-- Security Notice -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: rgba(239, 68, 68, 0.1); border-left: 4px solid #EF4444; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                        <tr>
                          <td>
                            <p style="margin: 0; color: #F87171; font-size: 14px; font-weight: 600;">
                              ⚠️ Security Notice
                            </p>
                            <p style="margin: 8px 0 0 0; color: #9CA3AF; font-size: 14px; line-height: 1.5;">
                              This link will expire in <strong style="color: #F9FAFB;">1 hour</strong> for security reasons. If you didn't request this reset, please ignore this email or contact support if you're concerned.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background: #111827; padding: 30px 40px; border-top: 1px solid #374151;">
                      <p style="margin: 0 0 12px 0; color: #6B7280; font-size: 13px; text-align: center; line-height: 1.5;">
                        Need help? Contact us at <a href="mailto:support@gameforge.ai" style="color: #6366F1; text-decoration: none;">support@gameforge.ai</a>
                      </p>
                      <p style="margin: 0; color: #4B5563; font-size: 12px; text-align: center;">
                        © 2026 GameForge AI. All rights reserved.<br>
                        This is an automated message, please do not reply to this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to: ${email}`);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  async sendVerificationEmail(email: string, verificationToken: string): Promise<void> {
    this.assertSmtpConfigured();
    const verificationUrl = `${this.configService.get<string>('email.frontendUrl')}/verify-email?token=${verificationToken}`;
    
    const mailOptions = {
      from: `"GameForge AI" <${this.configService.get<string>('email.user')}>`,
      to: email,
      subject: '🎮 Welcome to GameForge AI - Verify Your Email',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%);">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #0F172A 0%, #1E293B 100%); padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" border="0" style="background: #1F2937; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);">
                  <!-- Header with Gradient -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #10B981 0%, #34D399 100%); padding: 40px 30px; text-align: center;">
                      <h1 style="margin: 0; color: #FFFFFF; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">
                        🎮 GameForge AI
                      </h1>
                      <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px; font-weight: 500;">
                        AI-Powered Game Development
                      </p>
                    </td>
                  </tr>
                  
                  <!-- Content -->
                  <tr>
                    <td style="padding: 50px 40px;">
                      <h2 style="margin: 0 0 20px 0; color: #F9FAFB; font-size: 26px; font-weight: 600; text-align: center;">
                        Welcome to GameForge AI! 🚀
                      </h2>
                      
                      <p style="margin: 0 0 24px 0; color: #9CA3AF; font-size: 16px; line-height: 1.6;">
                        Hi there,
                      </p>
                      
                      <p style="margin: 0 0 24px 0; color: #9CA3AF; font-size: 16px; line-height: 1.6;">
                        Thank you for joining GameForge AI! We're excited to have you on board. To get started and unlock the full potential of AI-powered game development, please verify your email address.
                      </p>
                      
                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 32px 0;">
                        <tr>
                          <td align="center">
                            <a href="${verificationUrl}" 
                               style="display: inline-block; background: linear-gradient(135deg, #10B981 0%, #34D399 100%); 
                                      color: #FFFFFF; text-decoration: none; padding: 16px 48px; border-radius: 12px; 
                                      font-size: 16px; font-weight: 600; box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
                                      transition: all 0.3s ease;">
                              ✓ Verify My Email
                            </a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 0 0 16px 0; color: #9CA3AF; font-size: 14px; line-height: 1.6; text-align: center;">
                        Or copy and paste this link into your browser:
                      </p>
                      
                      <p style="margin: 0 0 32px 0; color: #10B981; font-size: 13px; word-break: break-all; 
                                background: rgba(16, 185, 129, 0.1); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
                        ${verificationUrl}
                      </p>
                      
                      <!-- Features Preview -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: rgba(99, 102, 241, 0.08); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                        <tr>
                          <td>
                            <p style="margin: 0 0 16px 0; color: #F9FAFB; font-size: 16px; font-weight: 600; text-align: center;">
                              🌟 What You Can Do with GameForge AI
                            </p>
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                              <tr>
                                <td style="padding: 8px 0;">
                                  <p style="margin: 0; color: #9CA3AF; font-size: 14px; line-height: 1.6;">
                                    <span style="color: #10B981; font-size: 16px;">✓</span> Create games with AI-powered assistance
                                  </p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0;">
                                  <p style="margin: 0; color: #9CA3AF; font-size: 14px; line-height: 1.6;">
                                    <span style="color: #10B981; font-size: 16px;">✓</span> Browse and use professional templates
                                  </p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0;">
                                  <p style="margin: 0; color: #9CA3AF; font-size: 14px; line-height: 1.6;">
                                    <span style="color: #10B981; font-size: 16px;">✓</span> Build and test your games instantly
                                  </p>
                                </td>
                              </tr>
                              <tr>
                                <td style="padding: 8px 0;">
                                  <p style="margin: 0; color: #9CA3AF; font-size: 14px; line-height: 1.6;">
                                    <span style="color: #10B981; font-size: 16px;">✓</span> Get intelligent coaching and guidance
                                  </p>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                      
                      <!-- Info Notice -->
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: rgba(59, 130, 246, 0.1); border-left: 4px solid #3B82F6; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                        <tr>
                          <td>
                            <p style="margin: 0; color: #60A5FA; font-size: 14px; font-weight: 600;">
                              ℹ️ Important
                            </p>
                            <p style="margin: 8px 0 0 0; color: #9CA3AF; font-size: 14px; line-height: 1.5;">
                              This verification link will expire in <strong style="color: #F9FAFB;">24 hours</strong>. If you didn't create a GameForge AI account, you can safely ignore this email.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="background: #111827; padding: 30px 40px; border-top: 1px solid #374151;">
                      <p style="margin: 0 0 12px 0; color: #6B7280; font-size: 13px; text-align: center; line-height: 1.5;">
                        Need help? Contact us at <a href="mailto:support@gameforge.ai" style="color: #10B981; text-decoration: none;">support@gameforge.ai</a>
                      </p>
                      <p style="margin: 0; color: #4B5563; font-size: 12px; text-align: center;">
                        © 2026 GameForge AI. All rights reserved.<br>
                        This is an automated message, please do not reply to this email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Verification email sent to: ${email}`);
    } catch (error) {
      console.error('Error sending verification email:', error);
      throw new Error('Failed to send verification email');
    }
  }
}
