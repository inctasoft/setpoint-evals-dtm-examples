#!/bin/bash

# Enhanced Real-time Job Monitoring Script (via Orchestrator API)
# Monitors workflow jobs with progress bars, current step, and error details

set -e

# Get script directory and load API configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${SCRIPT_DIR}/inc/api-config.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GRAY='\033[0;90m'
NC='\033[0m'
BOLD='\033[1m'

API_TIMEOUT=5
REFRESH_INTERVAL=3

# Function to draw a progress bar
draw_progress_bar() {
  local completed=$1
  local total=$2
  local width=30
  local percentage=0
  
  if [ "$total" -gt 0 ]; then
    percentage=$((completed * 100 / total))
  fi
  
  local filled=$((width * completed / (total > 0 ? total : 1)))
  local empty=$((width - filled))
  
  # Build the bar
  local bar="["
  for ((i=0; i<filled; i++)); do bar+="█"; done
  for ((i=0; i<empty; i++)); do bar+="░"; done
  bar+="]"
  
  # Color based on progress
  local color="${YELLOW}"
  if [ "$percentage" -eq 100 ]; then
    color="${GREEN}"
  elif [ "$percentage" -ge 75 ]; then
    color="${CYAN}"
  fi
  
  echo -e "${color}${bar}${NC} ${BOLD}${percentage}%${NC} (${completed}/${total})"
}

# Function to truncate text
truncate_text() {
  local text="$1"
  local max_len=$2
  if [ ${#text} -gt $max_len ]; then
    echo "${text:0:$((max_len-3))}..."
  else
    printf "%-${max_len}s" "$text"
  fi
}

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ${BOLD}Enhanced Workflow Jobs Monitor${NC}${BLUE}                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}📊 Features: Progress bars • Current step • Error details • Ack status${NC}"
echo -e "${GRAY}Press Ctrl+C to exit${NC}"
echo ""
echo -e "${GRAY}Status Icons: ${GREEN}✓${GRAY} Completed | ${BLUE}▶${GRAY} Processing | ${YELLOW}🔄${GRAY} Retrying | ${MAGENTA}⏱${GRAY} Waiting for Ack | ${RED}✗${GRAY} Failed | ${GRAY}○${GRAY} Pending${NC}"
echo ""

# Test API connectivity
echo -e "${YELLOW}🔌 Testing API connectivity...${NC}"
HEALTH_URL="${API_BASE_URL}/health"
if ! curl -s -f --max-time "$API_TIMEOUT" "$HEALTH_URL" > /dev/null 2>&1; then
  echo -e "${RED}❌ Cannot reach orchestrator at $API_BASE_URL${NC}"
  echo ""
  echo "Make sure the orchestrator is running:"
  echo "  ./bin/start.sh"
  echo ""
  exit 1
fi
echo -e "${GREEN}✅ API is reachable${NC}"
echo ""
sleep 1

while true; do
  clear
  
  # Fetch list of recent jobs from API
  JOBS_LIST=$(curl -s -f --max-time "$API_TIMEOUT" "$API_BASE_URL/jobs" 2>/dev/null || echo "")
  
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   ${BOLD}Workflow Jobs Status${NC}${BLUE} - $(date '+%H:%M:%S')                         ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  
  if [ -z "$JOBS_LIST" ]; then
    echo -e "${RED}❌ Failed to fetch jobs list${NC}"
    echo ""
    echo "Possible reasons:"
    echo "  - API endpoint not available"
    echo "  - Network timeout"
    echo "  - Orchestrator error"
    echo ""
  else
    JOBS_COUNT=$(echo "$JOBS_LIST" | jq '.total // 0' 2>/dev/null)
    
    if [ "$JOBS_COUNT" -eq 0 ]; then
      echo -e "${YELLOW}📭 No jobs found${NC}"
      echo ""
      echo "Submit a test job:"
      echo -e "  ${CYAN}curl -X POST $API_BASE_URL/workflows/order-processing/jobs \\${NC}"
      echo -e "    ${CYAN}-H 'Content-Type: application/json' \\${NC}"
      echo -e "    ${CYAN}-d '{\"variant\":\"default\",\"payload\":{\"entityId\":\"ENTITY-123\"}}'${NC}"
      echo ""
    else
      echo -e "${BOLD}${CYAN}📋 Recent Jobs (${JOBS_COUNT}):${NC}"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      
      # Parse and display each job with enhanced details
      echo "$JOBS_LIST" | jq -r '.jobs[] | @json' 2>/dev/null | while read -r job_json; do
        id=$(echo "$job_json" | jq -r '.id')
        type=$(echo "$job_json" | jq -r '.type')
        status=$(echo "$job_json" | jq -r '.status')
        submitted_by=$(echo "$job_json" | jq -r '.submittedBy // "unknown"')
        
        # Fetch detailed info for each job
        JOB_DETAILS=$(curl -s -f --max-time "$API_TIMEOUT" "$API_BASE_URL/jobs/$id" 2>/dev/null || echo "")
        
        if [ -n "$JOB_DETAILS" ]; then
          # Get step counts
          total_steps=$(echo "$JOB_DETAILS" | jq '.steps | length' 2>/dev/null || echo "0")
          completed_steps=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.status == "completed")] | length' 2>/dev/null || echo "0")
          failed_steps=$(echo "$JOB_DETAILS" | jq '[.steps[] | select(.status == "failed")] | length' 2>/dev/null || echo "0")
          
          # Get current processing step
          current_step=$(echo "$JOB_DETAILS" | jq -r '[.steps[] | select(.status == "in_progress" or .status == "delegated" or .status == "in_progress_retrying" or .status == "waiting_for_ack")] | first | .description // empty' 2>/dev/null)
          
          # Get error if failed
          job_error=$(echo "$JOB_DETAILS" | jq -r '.error // empty' 2>/dev/null)
          
          # Color code status
          case "$status" in
            "completed") 
              STATUS_COLOR="${GREEN}"
              STATUS_ICON="✅"
              ;;
            "processing") 
              STATUS_COLOR="${BLUE}"
              STATUS_ICON="⚙️ "
              ;;
            "failed") 
              STATUS_COLOR="${RED}"
              STATUS_ICON="❌"
              ;;
            "pending") 
              STATUS_COLOR="${YELLOW}"
              STATUS_ICON="⏳"
              ;;
            *) 
              STATUS_COLOR="${GRAY}"
              STATUS_ICON="○"
              ;;
          esac
          
          # Print job header
          echo ""
          echo -e "${STATUS_ICON} ${BOLD}Job:${NC} ${id:0:8}... ${GRAY}|${NC} ${BOLD}Type:${NC} ${type} ${GRAY}|${NC} ${STATUS_COLOR}${BOLD}${status}${NC}"
          
          # Print progress bar if job has steps
          if [ "$total_steps" -gt 0 ]; then
            echo -n "   Progress: "
            draw_progress_bar "$completed_steps" "$total_steps"
            
            # Show failed steps if any
            if [ "$failed_steps" -gt 0 ]; then
              echo -e "   ${RED}⚠️  Failed steps: ${failed_steps}${NC}"
            fi
          fi
          
          # Show current step if processing
          if [ "$status" = "processing" ] && [ -n "$current_step" ]; then
            echo -e "   ${CYAN}→ Current:${NC} $(truncate_text "$current_step" 50)"
          fi
          
          # Show error if failed
          if [ "$status" = "failed" ] && [ -n "$job_error" ]; then
            echo -e "   ${RED}💥 Error:${NC} $(truncate_text "$job_error" 60)"
          fi
          
          # Show detailed steps if processing or failed
          if [ "$status" = "processing" ] || [ "$status" = "failed" ]; then
            echo -e "   ${GRAY}Steps:${NC}"
            
            echo "$JOB_DETAILS" | jq -r '.steps[] | @json' 2>/dev/null | while read -r step_json; do
              step_num=$(echo "$step_json" | jq -r '.stepNumber')
              step_desc=$(echo "$step_json" | jq -r '.description // .stepName')
              step_status=$(echo "$step_json" | jq -r '.status')
              step_error=$(echo "$step_json" | jq -r '.error // empty')
              
              case "$step_status" in
                "completed") 
                  step_icon="${GREEN}✓${NC}"
                  ;;
                "in_progress"|"delegated") 
                  step_icon="${BLUE}▶${NC}"
                  ;;
                "in_progress_retrying")
                  step_icon="${YELLOW}🔄${NC}"
                  ;;
                "waiting_for_ack") 
                  step_icon="${MAGENTA}⏱${NC}"
                  ;;
                "failed") 
                  step_icon="${RED}✗${NC}"
                  ;;
                "pending") 
                  step_icon="${GRAY}○${NC}"
                  ;;
                *) 
                  step_icon="${GRAY}?${NC}"
                  ;;
              esac
              
              echo -e "     ${step_icon} ${GRAY}${step_num}.${NC} $(truncate_text "$step_desc" 45)"
              
              # Show retrying message
              if [ "$step_status" = "in_progress_retrying" ]; then
                echo -e "        ${YELLOW}↳ Retrying after failure (SQS retry in progress)${NC}"
              fi
              
              # Show waiting for acknowledgement message
              if [ "$step_status" = "waiting_for_ack" ]; then
                echo -e "        ${MAGENTA}↳ Waiting for external acknowledgement${NC}"
              fi
              
              # Show step error if failed
              if [ "$step_status" = "failed" ] && [ -n "$step_error" ]; then
                echo -e "        ${RED}↳ ${step_error}${NC}"
              fi
            done
          fi
          
          echo -e "${GRAY}   Submitted by: ${submitted_by}${NC}"
        fi
      done
      
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
  fi
    
    echo ""
    echo -e "${CYAN}🔗 API Endpoints:${NC}"
    echo -e "${GRAY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${BOLD}Health:${NC}         GET  $API_BASE_URL/health"
    echo -e "  ${BOLD}List Jobs:${NC}      GET  $API_BASE_URL/jobs"
    echo -e "  ${BOLD}Job Details:${NC}    GET  $API_BASE_URL/jobs/:jobId"
    echo -e "  ${BOLD}Initiate Job:${NC}   POST $API_BASE_URL/workflows/:workflowName/jobs"
    echo -e "  ${BOLD}Event Status:${NC}   GET  $API_BASE_URL/jobs/:jobId/status"
    echo -e "  ${BOLD}Event Progress:${NC} GET  $API_BASE_URL/jobs/:jobId/progress"
    echo -e "  ${BOLD}Swagger:${NC}        GET  $API_BASE_URL/api-docs"
    echo ""
    
    echo -e "${GRAY}Auto-refresh: ${REFRESH_INTERVAL}s | Last update: $(date '+%H:%M:%S') | ${GREEN}●${NC} Live | Ctrl+C to exit${NC}"
    echo ""
  
  sleep "$REFRESH_INTERVAL"
done
