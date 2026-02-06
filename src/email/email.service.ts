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
      subject: 'Password Reset Request - GameForge AI',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; text-align: center;">GameForge AI - Password Reset</h2>
          <p style="color: #666; line-height: 1.6;">
            Hello,<br><br>
            You requested a password reset for your GameForge AI account.<br>
            Click the button below to reset your password:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #007bff; color: white; padding: 12px 30px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; line-height: 1.6;">
            If you didn't request this password reset, you can safely ignore this email.<br>
            The link will expire in 1 hour for security reasons.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated message from GameForge AI.<br>
            Please do not reply to this email.
          </p>
        </div>
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
      subject: 'Verify Your Email - GameForge AI',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; text-align: center;">GameForge AI - Email Verification</h2>
          <p style="color: #666; line-height: 1.6;">
            Welcome to GameForge AI!<br><br>
            Please verify your email address by clicking the button below:
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #28a745; color: white; padding: 12px 30px; 
                      text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email
            </a>
          </div>
          <p style="color: #666; line-height: 1.6;">
            If you didn't create an account with GameForge AI, you can safely ignore this email.<br>
            The verification link will expire in 24 hours.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #999; font-size: 12px; text-align: center;">
            This is an automated message from GameForge AI.<br>
            Please do not reply to this email.
          </p>
        </div>
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
