import { Injectable, UnauthorizedException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/entities/user.entity';
import { RegisterDto, LoginDto, GoogleLoginDto } from './dto/auth.dto';
import { SessionsService } from './sessions.service';
import { EmailService } from '../email/email.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private sessionsService: SessionsService,
    private emailService: EmailService,
    private cloudinaryService: CloudinaryService,
  ) {}

  private _googleClient: OAuth2Client | null = null;

  private getGoogleClient(): OAuth2Client {
    if (this._googleClient) return this._googleClient;
    this._googleClient = new OAuth2Client();
    return this._googleClient;
  }

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userModel.findOne({ email });
    if (user && user.password && await bcrypt.compare(password, user.password)) {
      const { password, ...result } = user.toObject();
      return result;
    }
    return null;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.password) {
      throw new BadRequestException('Password change is not available for this account');
    }

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }

    const saltRounds = 12;
    const hashed = await bcrypt.hash(newPassword, saltRounds);
    user.password = hashed;
    await user.save();

    return {
      success: true,
      message: 'Password updated successfully',
    };
  }

  async login(loginDto: LoginDto, userAgent: string, ipAddress: string) {
    const { email, password, rememberMe = false } = loginDto;
    const user = await this.validateUser(email, password);
    
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    // Update last login
    await this.userModel.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    // Create session
    const session = await this.sessionsService.createSession(
      user._id.toString(),
      userAgent,
      ipAddress,
      rememberMe
    );

    const payload = { 
      email: user.email, 
      sub: user._id.toString(), 
      username: user.username,
      role: user.role,
      sessionId: session._id.toString()
    };

    // Choose token expiration based on remember me
    const tokenExpiration = rememberMe 
      ? this.configService.get<string>('jwt.rememberMeExpiresIn') || '30d'
      : this.configService.get<string>('jwt.expiresIn') || '24h';
    
    const access_token = this.jwtService.sign(payload, { expiresIn: tokenExpiration as any });

    return {
      success: true,
      message: 'Login successful',
      data: {
        access_token,
        refresh_token: session.refreshToken,
        user: {
          id: user._id.toString(),
          email: user.email,
          username: user.username,
          fullName: (user as any).fullName || '',
          bio: (user as any).bio || '',
          location: (user as any).location || '',
          website: (user as any).website || '',
          role: user.role,
          subscription: user.subscription,
          avatar: user.avatar,
        },
      },
    };
  }

  async googleLoginWithIdToken(
    googleLoginDto: GoogleLoginDto,
    userAgent: string,
    ipAddress: string,
  ) {
    const { idToken, rememberMe = true, role } = googleLoginDto;

    const clientIdConfig = this.configService.get<string>('google.clientId');
    const clientIds = (clientIdConfig ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (clientIds.length === 0) {
      throw new UnauthorizedException('Google client ID not configured');
    }

    const client = this.getGoogleClient();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientIds,
    });

    const payload = ticket.getPayload();
    const email = payload?.email;
    const googleId = payload?.sub;
    const avatar = payload?.picture || '';
    const displayName = payload?.name || '';

    if (!email || !googleId) {
      throw new UnauthorizedException('Invalid Google token');
    }

    let user = await this.userModel.findOne({ $or: [{ googleId }, { email }] });

    if (!user) {
      const baseUsername = email.split('@')[0];
      let username = baseUsername;
      let counter = 1;
      while (await this.userModel.findOne({ username })) {
        username = `${baseUsername}${counter++}`;
      }

      user = await new this.userModel({
        email,
        username,
        googleId,
        avatar,
        role: role ?? 'user',
        isEmailVerified: true,
      }).save();
    } else {
      await this.userModel.findByIdAndUpdate(user._id, {
        googleId,
        avatar: avatar || user.avatar,
        isEmailVerified: true,
      });
      user.googleId = googleId;
      user.avatar = avatar || user.avatar;
      user.isEmailVerified = true;
    }

    await this.userModel.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    const session = await this.sessionsService.createSession(
      user._id.toString(),
      userAgent,
      ipAddress,
      rememberMe,
    );

    const jwtPayload = {
      email: user.email,
      sub: user._id.toString(),
      username: user.username,
      role: user.role,
      sessionId: session._id.toString(),
    };

    const tokenExpiration = rememberMe
      ? this.configService.get<string>('jwt.rememberMeExpiresIn') || '30d'
      : this.configService.get<string>('jwt.expiresIn') || '24h';

    const access_token = this.jwtService.sign(jwtPayload, { expiresIn: tokenExpiration as any });

    return {
      success: true,
      message: 'Google login successful',
      data: {
        access_token,
        refresh_token: session.refreshToken,
        user: {
          id: user._id.toString(),
          email: user.email,
          username: user.username,
          fullName: (user as any).fullName || displayName || '',
          bio: (user as any).bio || '',
          location: (user as any).location || '',
          website: (user as any).website || '',
          role: user.role,
          subscription: user.subscription,
          avatar: user.avatar,
          name: displayName,
        },
      },
    };
  }

  async register(registerDto: RegisterDto, userAgent: string, ipAddress: string) {
    const { email, username, password, rememberMe = false } = registerDto;

    const existingUser = await this.userModel.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      if (existingUser.email === email) {
        throw new UnauthorizedException('User with this email already exists');
      }
      if (existingUser.username === username) {
        throw new UnauthorizedException('Username already taken');
      }
    }

    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const emailVerificationToken = randomBytes(32).toString('hex');
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const newUser = new this.userModel({
      email,
      username,
      password: hashedPassword,
      role: 'user',
      emailVerificationToken,
      emailVerificationExpires,
    });

    const user = await newUser.save();

    // Create session
    const session = await this.sessionsService.createSession(
      user._id.toString(),
      userAgent,
      ipAddress,
      rememberMe
    );

    const payload = { 
      email: user.email, 
      sub: user._id.toString(), 
      username: user.username,
      role: user.role,
      sessionId: session._id.toString()
    };

    // Choose token expiration based on remember me
    const tokenExpiration = rememberMe 
      ? this.configService.get<string>('jwt.rememberMeExpiresIn') || '30d'
      : this.configService.get<string>('jwt.expiresIn') || '24h';
    
    const access_token = this.jwtService.sign(payload, { expiresIn: tokenExpiration as any });

    return {
      success: true,
      message: 'Registration successful',
      data: {
        access_token,
        refresh_token: session.refreshToken,
        user: {
          id: user._id.toString(),
          email: user.email,
          username: user.username,
          fullName: (user as any).fullName || '',
          bio: (user as any).bio || '',
          location: (user as any).location || '',
          website: (user as any).website || '',
          role: user.role,
          subscription: user.subscription,
          avatar: user.avatar,
        },
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId);
    
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      success: true,
      data: {
        user: {
          id: user._id.toString(),
          email: user.email,
          username: user.username,
          fullName: (user as any).fullName || '',
          bio: (user as any).bio || '',
          location: (user as any).location || '',
          website: (user as any).website || '',
          role: user.role,
          subscription: user.subscription,
          avatar: user.avatar,
          projects: user.projects,
          lastLogin: user.lastLogin,
        },
      },
    };
  }

  async updateProfile(userId: string, updateData: any) {
    const { username, avatar, fullName, bio, location, website } = updateData as any;

    const normalizedUsername = typeof username === 'string' ? username.trim() : '';

    if (normalizedUsername) {
      const existingUser = await this.userModel.findOne({
        username: normalizedUsername,
        _id: { $ne: userId },
      });

      if (existingUser) {
        throw new UnauthorizedException('Username already taken');
      }
    }

    const update: any = {};
    if (normalizedUsername) {
      update.username = normalizedUsername;
    }
    if (typeof avatar === 'string') {
      update.avatar = avatar;
    }
    if (typeof fullName === 'string') {
      update.fullName = fullName.trim();
    }
    if (typeof bio === 'string') {
      update.bio = bio.trim();
    }
    if (typeof location === 'string') {
      update.location = location.trim();
    }
    if (typeof website === 'string') {
      update.website = website.trim();
    }

    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      update,
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return {
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser._id.toString(),
          email: updatedUser.email,
          username: updatedUser.username,
          fullName: (updatedUser as any).fullName || '',
          bio: (updatedUser as any).bio || '',
          location: (updatedUser as any).location || '',
          website: (updatedUser as any).website || '',
          role: updatedUser.role,
          subscription: updatedUser.subscription,
          avatar: updatedUser.avatar,
        },
      },
    };
  }

  async updateAvatar(userId: string, file: any) {
    const upload = await this.cloudinaryService.uploadAvatar(file);

    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      { avatar: upload.url },
      { new: true, runValidators: true },
    );

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return {
      success: true,
      message: 'Avatar updated successfully',
      data: {
        user: {
          id: updatedUser._id.toString(),
          email: updatedUser.email,
          username: updatedUser.username,
          fullName: (updatedUser as any).fullName || '',
          bio: (updatedUser as any).bio || '',
          location: (updatedUser as any).location || '',
          website: (updatedUser as any).website || '',
          role: updatedUser.role,
          subscription: updatedUser.subscription,
          avatar: updatedUser.avatar,
        },
      },
    };
  }

  async logout(userId: string) {
    await this.sessionsService.invalidateAllUserSessions(userId);
    return { success: true, message: 'Logged out successfully' };
  }

  async refreshToken(refreshToken: string) {
    const session = await this.sessionsService.findByRefreshToken(refreshToken);
    
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.sessionsService.updateLastActivity(session.sessionToken);

    const user = session.userId as any; // Type assertion for populated user
    const payload = { 
      email: user.email, 
      sub: user._id.toString(), 
      username: user.username,
      role: user.role,
      sessionId: session._id.toString()
    };
    
    const access_token = this.jwtService.sign(payload);
    return { 
      success: true, 
      data: { 
        access_token,
        refresh_token: session.refreshToken
      } 
    };
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    // Find user by email
    const user = await this.userModel.findOne({ email });
    
    if (!user) {
      // Don't reveal if email exists or not for security
      return { message: 'If an account with that email exists, a password reset link has been sent.' };
    }

    try {
      // Generate reset token
      const resetToken = randomBytes(32).toString('hex');
      const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now
      
      // Save reset token to user
      await this.userModel.updateOne(
        { _id: user._id },
        { 
          $set: {
            passwordResetToken: resetToken,
            passwordResetExpires: resetTokenExpiry,
          }
        }
      );
      
      // Send password reset email
      await this.emailService.sendPasswordResetEmail(email, resetToken);
      
      return { 
        message: 'If an account with that email exists, a password reset link has been sent.' 
      };
    } catch (error) {
      console.error('Password reset error:', error);
      return {
        message: 'If an account with that email exists, a password reset link has been sent.',
      };
    }
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.userModel.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset token
    await this.userModel.updateOne(
      { _id: user._id },
      { 
        $set: { password: hashedPassword },
        $unset: { passwordResetToken: 1, passwordResetExpires: 1 }
      }
    );

    return { message: 'Password reset successful' };
  }

  async getActiveSessions(userId: string) {
    const sessions = await this.sessionsService.getUserSessions(userId);
    
    return {
      success: true,
      data: {
        sessions: sessions.map(session => ({
          id: session._id.toString(),
          browser: session.browser,
          os: session.os,
          ipAddress: session.ipAddress,
          isPersistent: session.isPersistent,
          lastActivity: session.lastActivity,
          expiresAt: session.expiresAt,
          createdAt: session.createdAt,
        })),
      },
    };
  }

  async revokeSession(sessionId: string, userId: string) {
    const session = await this.sessionsService.findBySessionToken(sessionId);
    
    if (!session || session.userId.toString() !== userId) {
      throw new UnauthorizedException('Session not found or access denied');
    }

    await this.sessionsService.invalidateSession(sessionId);
    return { success: true, message: 'Session revoked successfully' };
  }

  async verifyEmail(token: string) {
    const user = await this.userModel.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.userModel.findByIdAndUpdate(user._id, {
      isEmailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationExpires: undefined,
    });

    return { success: true, message: 'Email verified successfully' };
  }
}
