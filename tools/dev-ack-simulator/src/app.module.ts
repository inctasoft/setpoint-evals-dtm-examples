import { Module, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { KafkaModule } from "./kafka/kafka.module";
import { SimulatorModule } from "./simulator/simulator.module";
import { CorrelationModule } from "./common/correlation/correlation.module";
import { CorrelationMiddleware } from "./common/middleware/correlation.middleware";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", ".env.local", ".env.development"],
    }),
    CorrelationModule,
    KafkaModule,
    SimulatorModule,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(CorrelationMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
