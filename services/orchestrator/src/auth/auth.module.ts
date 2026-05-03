import { Module, DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { middleware } from 'supertokens-node/framework/express';
import { initSuperTokens } from './supertokens.config';
import { AuthGuard } from './auth.guard';

@Module({})
export class AuthModule implements NestModule {
  static forRoot(): DynamicModule {
    initSuperTokens();
    return {
      module: AuthModule,
      global: true,
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(middleware()).forRoutes('*');
  }
}
