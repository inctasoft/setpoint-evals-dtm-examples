// Quick test to verify mock behavior
const dto = {
  jobId: 'job-123',
  stepId: 'step-2',
  status: 'failed',
  error: 'Processing error',
};

const mockStep = {
  id: 'step-2',
  jobId: 'job-123',
  status: 'in_progress_retrying',
  retryCount: 2,
  maxRetryCount: 3,
};

const findById = jest.fn();
findById
  .mockResolvedValueOnce(mockStep)
  .mockResolvedValueOnce({ ...mockStep, retryCount: 3, maxRetryCount: 3 });

// Simulate the calls
(async () => {
  const first = await findById('step-2');
  console.log('First call:', first);
  
  const second = await findById('step-2');
  console.log('Second call:', second);
  console.log('Second call retryCount < maxRetryCount:', second.retryCount < second.maxRetryCount);
})();
