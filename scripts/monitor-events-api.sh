#!/bin/bash

# Enhanced Real-time Event Monitoring Script (New Event-Based API)
# Monitors job events with progress bars, current step, and error details
# Uses NEW endpoints: /migration/{jobId}/status and /migration/{jobId}/progress

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

# Function to format status with icon and color
format_status() {
  local status="$1"
  case "$status" in
    "COMPLETED") 
      echo -e "${GREEN}✅ COMPLETED${NC}"
      ;;
    "IN_PROGRESS") 
      echo -e "${BLUE}⚙️  IN_PROGRESS${NC}"
      ;;
    "FAILED") 
      echo -e "${RED}❌ FAILED${NC}"
      ;;
    "PENDING") 
      echo -e "${YELLOW}⏳ PENDING${NC}"
      ;;
    *) 
      echo -e "${GRAY}○ ${status}${NC}"
      ;;
  esac
}

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ${BOLD}Job Events Monitor (NEW API)${NC}${BLUE}                              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}📊 Features: Event-based API • Progress tracking • Status monitoring${NC}"
echo -e "${GRAY}Press Ctrl+C to exit${NC}"
echo ""

# Test API connectivity
echo -e "${YELLOW}🔌 Testing API connectivity...${NC}"
HEALTH_URL="${API_BASE_URL}/health"
if ! curl -s -f --max-time "$API_TIMEOUT" "$HEALTH_URL" > /dev/null 2>&1; then
  echo -e "${RED}❌ Cannot reach orchestrator at $API_BASE_URL${NC}"
  echo ""
  echo "Make sure the orchestrator is running:"
  echo "  ./scripts/local-env.sh start --standalone"
  echo ""
  exit 1
fi
echo -e "${GREEN}✅ API is reachable${NC}"
echo ""
sleep 2

while true; do
  clear
  echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   ${BOLD}Job Events Status${NC}${BLUE} - $(date '+%H:%M:%S')                          ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  
  # Fetch list of recent events (using legacy endpoint for list, then call new endpoints for details)
  EVENTS_LIST=$(curl -s -f --max-time "$API_TIMEOUT" "$API_BASE_URL/jobs" 2>/dev/null || echo "")
  
  if [ -z "$EVENTS_LIST" ]; then
    echo -e "${RED}❌ Failed to fetch events list${NC}"
    echo ""
    echo "Possible reasons:"
    echo "  - API endpoint not available"
    echo "  - Network timeout"
    echo "  - Orchestrator error"
    echo ""
  else
    EVENTS_COUNT=$(echo "$EVENTS_LIST" | jq '.total // 0' 2>/dev/null)
    
    if [ "$EVENTS_COUNT" -eq 0 ]; then
      echo -e "${YELLOW}📭 No job events found${NC}"
      echo ""
      echo "Submit a test job using the workflow API:"
      echo -e "  ${CYAN}curl -X POST $API_BASE_URL/workflows/order-processing/jobs \\${NC}"
      echo -e "    ${CYAN}-H 'Content-Type: application/json' \\${NC}"
      echo -e "    ${CYAN}-d '{${NC}"
      echo -e "      ${CYAN}\"variant\": \"default\",${NC}"
      echo -e "      ${CYAN}\"payload\": { \"entityId\": \"ENTITY-123\" }${NC}"
      echo -e "    ${CYAN}}'${NC}"
      echo ""
    else
      echo -e "${BOLD}${CYAN}📋 Recent Events (${EVENTS_COUNT}):${NC}"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      
      # Parse and display each event with enhanced details
      echo "$EVENTS_LIST" | jq -r '.jobs[] | @json' 2>/dev/null | while read -r event_json; do
        job_id=$(echo "$event_json" | jq -r '.id')
        type=$(echo "$event_json" | jq -r '.type')
        
        # Fetch event progress using NEW API endpoint
        EVENT_PROGRESS=$(curl -s -f --max-time "$API_TIMEOUT" "$API_BASE_URL/migration/$job_id/progress" 2>/dev/null || echo "")
        
        if [ -n "$EVENT_PROGRESS" ]; then
          # Extract fields from NEW API response
          status=$(echo "$EVENT_PROGRESS" | jq -r '.status // "UNKNOWN"')
          entity_id=$(echo "$EVENT_PROGRESS" | jq -r '.payload.entityId // .entityId // "N/A"')
          job_type=$(echo "$EVENT_PROGRESS" | jq -r '.type // "N/A"')
          total_entities=$(echo "$EVENT_PROGRESS" | jq -r '.progress.totalEntities // 0')
          completed_entities=$(echo "$EVENT_PROGRESS" | jq -r '.progress.completedEntities // 0')
          percent_complete=$(echo "$EVENT_PROGRESS" | jq -r '.progress.percentComplete // 0')
          current_step=$(echo "$EVENT_PROGRESS" | jq -r '.currentStep // ""')
          started_at=$(echo "$EVENT_PROGRESS" | jq -r '.startedAt // ""')
          completed_at=$(echo "$EVENT_PROGRESS" | jq -r '.completedAt // ""')
          tracking_url=$(echo "$EVENT_PROGRESS" | jq -r '.trackingUrl // ""')
          
          # Print event header
          echo ""
          echo -e "$(format_status "$status") ${BOLD}Event:${NC} ${job_id:0:8}... ${GRAY}|${NC} ${BOLD}Type:${NC} ${type}"
          echo -e "   ${BOLD}Entity:${NC} ${entity_id} ${GRAY}|${NC} ${BOLD}Type:${NC} ${job_type}"
          
          # Print progress bar if event has entities
          if [ "$total_entities" -gt 0 ]; then
            echo -n "   ${BOLD}Progress:${NC} "
            draw_progress_bar "$completed_entities" "$total_entities"
          fi
          
          # Show current step if processing
          if [ "$status" = "IN_PROGRESS" ] && [ -n "$current_step" ]; then
            echo -e "   ${CYAN}→ Current:${NC} $(truncate_text "$current_step" 50)"
          fi
          
          # Show timestamps
          if [ -n "$started_at" ] && [ "$started_at" != "null" ]; then
            started_time=$(date -d "$started_at" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "$started_at")
            echo -e "   ${GRAY}Started:${NC} $started_time"
          fi
          
          if [ -n "$completed_at" ] && [ "$completed_at" != "null" ]; then
            completed_time=$(date -d "$completed_at" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "$completed_at")
            echo -e "   ${GREEN}Completed:${NC} $completed_time"
          fi
          
          # Show tracking URL
          if [ -n "$tracking_url" ] && [ "$tracking_url" != "null" ]; then
            echo -e "   ${GRAY}Track:${NC} ${API_BASE_URL}${tracking_url}"
          fi
          
        else
          # Fallback if new endpoint fails
          echo ""
          echo -e "${YELLOW}⚠️  Event: ${job_id:0:8}... ${GRAY}|${NC} Type: ${type}${NC}"
          echo -e "   ${RED}Could not fetch progress (new API endpoint may be unavailable)${NC}"
        fi
      done
      
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
  fi
  
  echo ""
  echo -e "${CYAN}🔗 NEW Event-Based API Endpoints:${NC}"
  echo -e "${GRAY}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  ${BOLD}Health:${NC}         GET  $API_BASE_URL/health"
  echo -e "  ${BOLD}Initiate:${NC}       POST $API_BASE_URL/workflows/{workflowName}/jobs"
  echo -e "  ${BOLD}Event Status:${NC}   GET  $API_BASE_URL/migration/{jobId}/status"
  echo -e "  ${BOLD}Event Progress:${NC} GET  $API_BASE_URL/migration/{jobId}/progress"
  echo -e "  ${BOLD}Swagger:${NC}        GET  $API_BASE_URL/api-docs"
  echo ""
  
  echo -e "${GRAY}Refreshing in 3 seconds... (Ctrl+C to exit)${NC}"
  echo ""
  
  sleep 3
done

