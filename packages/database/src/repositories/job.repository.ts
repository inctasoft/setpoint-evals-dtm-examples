import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between } from "typeorm";
import {
  Job,
  JobStatus,
  JobType,
  JobPayload,
  JobResults,
} from "../entities/job.entity";

export interface CreateJobDto {
  id?: string; // Optional: if provided, will use this UUID instead of generating one
  workflowName?: string; // Workflow identifier (e.g., 'order-processing')
  type: JobType | string;
  payload: JobPayload;
  submittedBy?: string;
}

@Injectable()
export class JobRepository {
  constructor(
    @InjectRepository(Job)
    private readonly repo: Repository<Job>,
  ) {}

  /**
   * Create a new job
   */
  async createJob(dto: CreateJobDto): Promise<Job> {
    const job = this.repo.create({
      ...(dto.id && { id: dto.id }), // Include ID if provided
      workflowName: dto.workflowName || "order-processing",
      type: dto.type,
      status: JobStatus.PENDING,
      payload: dto.payload,
      submittedBy: dto.submittedBy || "system",
      submittedAt: new Date(),
    });
    return this.repo.save(job);
  }

  /**
   * Find job by ID with all relationships
   */
  async findById(id: string, includeRelations = true): Promise<Job | null> {
    return this.repo.findOne({
      where: { id },
      relations: includeRelations ? ["steps"] : [],
    });
  }

  /**
   * Find recent jobs (all statuses) ordered by submission time
   */
  async findRecentJobs(limit: number = 10): Promise<Job[]> {
    return this.repo.find({
      take: limit,
      order: { submittedAt: "DESC" },
    });
  }

  /**
   * Find pending jobs (for processing)
   */
  async findPendingJobs(limit: number = 10): Promise<Job[]> {
    return this.repo.find({
      where: { status: JobStatus.PENDING },
      take: limit,
      order: { submittedAt: "ASC" },
    });
  }

  /**
   * Find jobs by status
   */
  async findByStatus(status: JobStatus, limit?: number): Promise<Job[]> {
    return this.repo.find({
      where: { status },
      take: limit,
      order: { submittedAt: "DESC" },
    });
  }

  /**
   * Find failed jobs in date range
   */
  async findFailedJobsInRange(start: Date, end: Date): Promise<Job[]> {
    return this.repo.find({
      where: {
        status: JobStatus.FAILED,
        completedAt: Between(start, end),
      },
      relations: ["steps"],
      order: { completedAt: "DESC" },
    });
  }

  /**
   * Find jobs by type
   */
  async findByType(type: JobType | string, limit?: number): Promise<Job[]> {
    return this.repo.find({
      where: { type },
      take: limit,
      order: { submittedAt: "DESC" },
    });
  }

  /**
   * Update job status
   */
  async updateStatus(
    id: string,
    status: JobStatus,
    error?: string,
  ): Promise<void> {
    const updateData: Partial<Job> = {
      status,
      updatedAt: new Date(),
    };

    if (status === JobStatus.PROCESSING) {
      updateData.startedAt = new Date();
    }

    if (
      status === JobStatus.COMPLETED ||
      status === JobStatus.FAILED ||
      status === JobStatus.PARTIAL_SUCCESS
    ) {
      updateData.completedAt = new Date();
    }

    if (error) {
      updateData.error = error;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    await this.repo.update(id, updateData as any);
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(id: string): Promise<void> {
    await this.repo.increment({ id }, "retryCount", 1);
  }

  /**
   * Update job results (summary data)
   * Called when job completes (success or failure)
   */
  async updateResults(id: string, results: JobResults): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    await this.repo.update(id, { results } as any);
  }

  /**
   * Update job payload (for dynamic data injection)
   * Used when orchestrator needs to enrich payload based on worker outputs
   * Example: ValidateCustomer returns customer data, which is then added to payload
   */
  async updatePayload(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    await this.repo.update(id, { payload } as any);
  }

  /**
   * Find jobs that need retry
   */
  async findJobsForRetry(): Promise<Job[]> {
    return this.repo
      .createQueryBuilder("job")
      .where("job.status = :status", { status: JobStatus.FAILED })
      .andWhere("job.retryCount < job.maxRetries")
      .orderBy("job.completedAt", "ASC")
      .take(10)
      .getMany();
  }

  /**
   * Get job statistics
   */
  async getStatistics(startDate?: Date, endDate?: Date) {
    const query = this.repo.createQueryBuilder("job");

    if (startDate && endDate) {
      query.where("job.submittedAt BETWEEN :start AND :end", {
        start: startDate,
        end: endDate,
      });
    }

    const [jobs, total] = await query.getManyAndCount();

    const stats = {
      total,
      byStatus: {
        pending: jobs.filter((j) => j.status === JobStatus.PENDING).length,
        processing: jobs.filter((j) => j.status === JobStatus.PROCESSING)
          .length,
        completed: jobs.filter((j) => j.status === JobStatus.COMPLETED).length,
        failed: jobs.filter((j) => j.status === JobStatus.FAILED).length,
      },
      byType: {} as Record<string, number>,
    };

    jobs.forEach((job) => {
      const type = job.type;
      stats.byType[type] = (stats.byType[type] || 0) + 1;
    });

    return stats;
  }

  /**
   * Delete old completed jobs (cleanup)
   */
  async deleteOldJobs(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where("status IN (:...statuses)", {
        statuses: [JobStatus.COMPLETED, JobStatus.CANCELLED],
      })
      .andWhere("completedAt < :cutoff", { cutoff: cutoffDate })
      .execute();

    return result.affected || 0;
  }
}

