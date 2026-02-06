import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import { Session, SessionSchema } from './schemas/session.schema';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SessionsService } from './sessions.service';
import { CommonModule } from '../common/common.module';
import { RolesGuard } from './guards/roles.guard';
import { EmailService } from '../email/email.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema }
    ]),
    CommonModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService, RolesGuard, EmailService, CloudinaryService],
  exports: [AuthService, SessionsService],
})
export class AuthModule {}
