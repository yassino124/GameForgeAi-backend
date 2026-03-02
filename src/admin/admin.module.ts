import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { CommonModule } from '../common/common.module';
import { User, UserSchema } from '../users/entities/user.entity';
import { GameProject, GameProjectSchema } from '../projects/schemas/game-project.schema';
import { UnityTemplate, UnityTemplateSchema } from '../templates/schemas/unity-template.schema';
import { Session, SessionSchema } from '../auth/schemas/session.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    CommonModule,
    NotificationsModule,
    EmailModule,
    AiModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: GameProject.name, schema: GameProjectSchema },
      { name: UnityTemplate.name, schema: UnityTemplateSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [AdminController, AdminUsersController],
  providers: [AdminUsersService],
})
export class AdminModule {}
