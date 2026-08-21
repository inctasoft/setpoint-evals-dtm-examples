import { Module, Global } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Job, Step, DeadLetter } from "./entities";
import { JobRepository, StepRepository } from "./repositories";

/**
 * Database Module
 *
 * This module provides database entities and repositories for the service.
 *
 * IMPORTANT: This module does NOT configure the database connection itself.
 * The consuming application (e.g., orchestrator) is responsible for configuring
 * TypeOrmModule.forRoot() or TypeOrmModule.forRootAsync() with the appropriate
 * runtime-detected connection settings.
 *
 * This separation allows the orchestrator to use runtime detection to automatically
 * select the correct database host/port based on the execution environment:
 * - Local: localhost:5448 (host-mapped port)
 * - Docker: dtm-db:5432 (Docker service name)
 * - EKS: RDS endpoint from ConfigMap/Secrets
 */
@Global()
@Module({
  imports: [
    // Only register entities for the connection configured by the consuming app
    TypeOrmModule.forFeature([Job, Step, DeadLetter]),
  ],
  providers: [JobRepository, StepRepository],
  exports: [TypeOrmModule, JobRepository, StepRepository],
})
export class DatabaseModule {}
