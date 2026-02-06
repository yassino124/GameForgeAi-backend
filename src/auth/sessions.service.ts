import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Session, SessionDocument } from './schemas/session.schema';
import { randomBytes } from 'crypto';
import { Request } from 'express';

@Injectable()
export class SessionsService {
  constructor(@InjectModel(Session.name) private sessionModel: Model<SessionDocument>) {}

  async createSession(
    userId: string,
    userAgent: string,
    ipAddress: string,
    rememberMe: boolean = false,
  ): Promise<SessionDocument> {
    const sessionToken = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    
    // Set expiration based on remember me
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (rememberMe ? 720 : 24)); // 30 days or 1 day

    const session = new this.sessionModel({
      userId,
      sessionToken,
      refreshToken,
      userAgent,
      ipAddress,
      isPersistent: rememberMe,
      expiresAt,
    });

    return session.save();
  }

  async findBySessionToken(sessionToken: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ 
      sessionToken, 
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('userId').exec();
  }

  async findByRefreshToken(refreshToken: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ 
      refreshToken, 
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).populate('userId').exec();
  }

  async updateLastActivity(sessionToken: string): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionToken },
      { lastActivity: new Date() }
    );
  }

  async invalidateSession(sessionToken: string): Promise<void> {
    await this.sessionModel.updateOne(
      { sessionToken },
      { isActive: false }
    );
  }

  async invalidateAllUserSessions(userId: string): Promise<void> {
    await this.sessionModel.updateMany(
      { userId },
      { isActive: false }
    );
  }

  async getUserSessions(userId: string): Promise<SessionDocument[]> {
    return this.sessionModel.find({ 
      userId, 
      isActive: true,
      expiresAt: { $gt: new Date() }
    }).sort({ lastActivity: -1 }).exec();
  }

  async cleanupExpiredSessions(): Promise<void> {
    await this.sessionModel.deleteMany({
      $or: [
        { expiresAt: { $lt: new Date() } },
        { isActive: false }
      ]
    });
  }

  extractDeviceInfo(req: Request): { userAgent: string; ipAddress: string; browser: string; os: string } {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';
    
    // Simple browser and OS detection
    let browser = 'Unknown';
    let os = 'Unknown';

    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';

    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iOS')) os = 'iOS';

    return { userAgent, ipAddress, browser, os };
  }
}
