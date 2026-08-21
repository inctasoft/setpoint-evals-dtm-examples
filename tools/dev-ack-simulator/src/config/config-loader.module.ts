/**
 * Config Loader Module
 *
 * Provides the workflow config, ACK subscriptions, and ack-defaults
 * to the rest of the application via NestJS dependency injection.
 *
 * At startup:
 * 1. Loads WorkflowDefinition from WORKFLOW_CONFIG_PATH
 * 2. Derives AckSubscription[] from cascades
 * 3. Loads AckDefaultsProvider from ACK_DEFAULTS_PATH (optional)
 */
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ConfigLoaderService } from "./config-loader.service";
import { ACK_SUBSCRIPTIONS } from "./ack-subscription.interface";
import { ACK_DEFAULTS_PROVIDER } from "../payload/ack-defaults-provider.interface";
import { loadAckDefaults } from "../payload/ack-defaults-loader";

@Module({
  imports: [ConfigModule],
  providers: [
    ConfigLoaderService,

    // Provide ACK_SUBSCRIPTIONS by loading the config at startup
    {
      provide: ACK_SUBSCRIPTIONS,
      useFactory: (configLoader: ConfigLoaderService) => {
        configLoader.loadConfig();
        return configLoader.getSubscriptions();
      },
      inject: [ConfigLoaderService],
    },

    // Provide ACK_DEFAULTS_PROVIDER by loading the ack-defaults file
    {
      provide: ACK_DEFAULTS_PROVIDER,
      useFactory: (configService: ConfigService) => {
        const defaultsPath = configService.get<string>("ACK_DEFAULTS_PATH");
        return loadAckDefaults(defaultsPath);
      },
      inject: [ConfigService],
    },
  ],
  exports: [ACK_SUBSCRIPTIONS, ACK_DEFAULTS_PROVIDER, ConfigLoaderService],
})
export class ConfigLoaderModule {}
