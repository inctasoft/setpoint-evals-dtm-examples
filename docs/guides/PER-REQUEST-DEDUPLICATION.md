# Per-Request Deduplication Control

## ✅ **Problem Solved**

Previously, testing deduplication required:
- ❌ Changing global `ENABLE_DEDUPLICATION` env var
- ❌ Restarting orchestrator (90-120 seconds!)
- ❌ Complex enable/disable logic in test scripts
- ❌ Could not reuse IDs during development

---

## 🎯 **New Solution: Per-Request Deduplication**

Deduplication can now be controlled **per-request** using the `testOptions.enableDeduplication` flag:

```json
{
  "deduplicationKey": "entity-1005",
  "externalSystemId": "uuid...",
  "webhookUrl": "https://...",
  "payload": {
    "customerId": 1005
  },
  "testOptions": {
    "enableDeduplication": true,  // ✅ Enable for this specific request
    "ValidateCustomer": { "simDelay": 2000 },
    "ValidateOrder": { "simDelay": 2000 },
    ...
  }
}
```

---

## 📊 **How It Works**

### **Priority Order:**
```
Per-request flag  >  Global env var
```

### **Behavior:**

| testOptions.enableDeduplication | Global Env Var | Result |
|-------------------------------|----------------|--------|
| `true` | `false` | ✅ Deduplication **ON** |
| `false` | `true` | ✅ Deduplication **OFF** |
| `undefined` | `true` | ✅ Deduplication **ON** |
| `undefined` | `false` | ✅ Deduplication **OFF** |

---

## 🛠️ **Changes Made**

### **1. DTO Renamed: `SimulatedDelaysDto` → `TestOptionsDto`**

**Before:**
```typescript
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 10000 },
    ...
  }
}
```

**After:**
```typescript
{
  "testOptions": {
    // Simulated delays (existing)
    "ValidateCustomer": { "simDelay": 10000 },
    ...
    
    // NEW: Feature flags
    "enableDeduplication": true
  }
}
```

---

### **2. DeduplicationService Updated**

```typescript
async findExistingJob(
  identifier: string,
  source: string,
  additionalContext?: Record<string, unknown>,
  enableDeduplication?: boolean,  // NEW: Per-request override
): Promise<Job | null> {
  // Priority: per-request flag > global env var
  const shouldDeduplicate =
    enableDeduplication !== undefined 
      ? enableDeduplication 
      : this.isEnabled();
  
  if (!shouldDeduplicate) {
    return null;
  }
  
  // ... existing deduplication logic ...
}
```

---

### **3. IngestionController Updated**

```typescript
const existingJob = await this.deduplicationService.findExistingJob(
  dto.deduplicationKey?.toString(),
  'api',
  { workflowName },
  dto.testOptions?.enableDeduplication, // ✅ Pass per-request flag
);
```

---

### **4. Eval 05 Updated**

```bash
PAYLOAD=$(cat <<EOF
{
  "deduplicationKey": "entity-1005",
  "externalSystemId": "$UUID",
  "webhookUrl": "https://...",
  "payload": {
    "customerId": 1005
  },
  "testOptions": {
    "enableDeduplication": true,  # ✅ Enable for this test
    "ValidateCustomer": { "simDelay": 2000 },
    ...
  }
}
EOF
)
```

---

### **5. Run-All Script Simplified**

**Before:**
```bash
# Enable deduplication globally
enable_deduplication
trap 'disable_deduplication' EXIT

# Run tests (90-120s orchestrator restart!)

# Disable deduplication
disable_deduplication
```

**After:**
```bash
# No orchestrator restarts needed!
# Eval 05 passes enableDeduplication: true in payload
# All other evals omit it (defaults to global env var = false)
```

---

## 📈 **Benefits**

| Aspect | Before | After |
|--------|--------|-------|
| **Orchestrator Restarts** | 2× (enable + disable) | **0×** |
| **Startup Time** | ~180-240s | **~0s** |
| **Development** | Can't reuse IDs | **✅ Can reuse IDs** |
| **Eval Complexity** | Complex enable/disable | **✅ Simple payload flag** |
| **Test Reliability** | Docker-compose issues | **✅ No Docker overhead** |
| **Production Control** | Global only | **✅ Per-customer A/B testing** |

---

## 🎯 **Use Cases**

### **1. Development (Default: Deduplication OFF)**

```bash
# .env.development
ENABLE_DEDUPLICATION=false  # Default
```

✅ **Reuse same IDs** during development  
✅ **No orchestrator restarts** needed  
✅ **Fast iteration**

---

### **2. Testing Deduplication (Eval 05)**

```json
{
  "testOptions": {
    "enableDeduplication": true  // Override global setting
  }
}
```

✅ **No orchestrator restart** needed  
✅ **Per-request control**

---

### **3. Production A/B Testing**

```json
// Customer A: Deduplication ON
{
  "testOptions": {
    "enableDeduplication": true
  }
}

// Customer B: Deduplication OFF
{
  "testOptions": {
    "enableDeduplication": false
  }
}
```

✅ **Per-customer control**  
✅ **No deployment** needed

---

## 🧪 **Testing**

### **Run All Evals (No Restarts!)**

```bash
cd setpoint-evals
./run-all.sh --parallel
```

**Time saved:** ~2-4 minutes per test run! 🚀

---

## 📚 **Related Files**

- **DTO:** `services/orchestrator/src/ingestion/dto/initiate-workflow-job.dto.ts`
- **Service:** `services/orchestrator/src/common/deduplication.service.ts`
- **Controller:** `services/orchestrator/src/ingestion/ingestion.controller.ts`
- **Payload Types:** `packages/database/src/entities/job.entity.ts`
- **Worker Utils:** `packages/lambda-worker-utils/src/simulation.ts`
- **Test:** `setpoint-evals/SE-03-deduplication/test.sh`
- **Runner:** `setpoint-evals/run-all.sh`

---

## 🔧 **Migration Guide (If Needed)**

If you have existing code using flat testOptions keys, update to step-keyed format:

**Before (flat keys):**
```json
{
  "testOptions": {
    "extractConsumer": 10000
  }
}
```

**After (step-keyed):**
```json
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 10000 }
  }
}
```

**Note:** testOptions now use step-type-keyed format with structured option sets (simDelay, failOnAttempts, ackDelay, etc.).

---

**Date:** 2025-11-28  
**Impact:** High (eliminates orchestrator restarts, enables production A/B testing)  
**Status:** ✅ Implemented

