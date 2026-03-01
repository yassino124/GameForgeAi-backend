import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../users/entities/user.entity';

/**
 * Guard that checks if a user's current status is 'active'.
 * Runs AFTER JwtAuthGuard, so request.user is already populated.
 * Prevents suspended/banned users from accessing protected endpoints.
 * 
 * This guard only validates if:
 * 1. User has a valid JWT token (request.user exists)
 * 2. User is not an admin (admins can never be suspended)
 */
@Injectable()
export class StatusCheckGuard implements CanActivate {
  private userModel: Model<UserDocument> | null = null;

  constructor(private moduleRef: ModuleRef) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Set by JwtAuthGuard

    // If no user in request, let the request proceed (JwtAuthGuard will block if needed)
    if (!user || !user.sub) {
      return true;
    }

    // Admins are exempt from status checks - they should always have access
    if (user.role === 'admin') {
      return true;
    }

    // Lazy load the User model on first use
    if (!this.userModel) {
      try {
        this.userModel = this.moduleRef.get('UserModel', { strict: false });
      } catch (e) {
        // Model not available, skip check
        return true;
      }
    }

    if (!this.userModel) {
      return true;
    }

    // Fetch user's current status from database
    const dbUser = await this.userModel.findById(user.sub).select('status isActive').lean();

    if (!dbUser) {
      throw new UnauthorizedException('User not found');
    }

    // Check status field (suspended, banned)
    const status = dbUser.status || (dbUser.isActive ? 'active' : 'suspended');

    if (status === 'suspended') {
      throw new UnauthorizedException('Account is suspended. Contact support to restore access.');
    }

    if (status === 'banned') {
      throw new UnauthorizedException('Account is banned and cannot be restored.');
    }

    return true;
  }
}
