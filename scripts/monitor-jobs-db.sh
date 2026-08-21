#!/bin/bash

# Real-time Job Monitoring Script
# Monitors workflow jobs and steps in the database

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"
DB_HOST="${DTM_DB_HOST:-localhost}"
DB_PORT="${DTM_DB_PORT_HOST:-5448}"
DB_USER="${DTM_DB_USER:-dtm_user}"
DB_PASSWORD="${DTM_DB_PASSWORD:-your_password}"
DB_NAME="${DTM_DB_NAME:-dtm}"

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DTM Jobs Real-Time Monitor                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Press Ctrl+C to exit${NC}"
echo ""

while true; do
  clear
  echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
  echo -e "${BLUE}║   DTM Jobs Status - $(date '+%H:%M:%S')              ║${NC}"
  echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
  echo ""
  
  # Query jobs
  JOBS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "
    SELECT 
      id,
      type,
      status,
      submitted_by,
      TO_CHAR(submitted_at, 'HH24:MI:SS') as submitted,
      TO_CHAR(started_at, 'HH24:MI:SS') as started,
      TO_CHAR(completed_at, 'HH24:MI:SS') as completed
    FROM dtm_jobs 
    ORDER BY submitted_at DESC 
    LIMIT 10;
  " 2>/dev/null || echo "")
  
  if [ -z "$JOBS" ]; then
    echo -e "${YELLOW}No jobs found${NC}"
  else
    echo -e "${CYAN}Recent Jobs:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    printf "%-38s %-12s %-12s %-10s %-8s %-8s %-8s\n" "Job ID" "Type" "Status" "Submitted" "Sub Time" "Start" "Done"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    echo "$JOBS" | while IFS='|' read -r id type status submitted_by submitted started completed; do
      # Color code status
      case "$status" in
        "completed") STATUS_COLOR="${GREEN}" ;;
        "processing") STATUS_COLOR="${BLUE}" ;;
        "failed") STATUS_COLOR="${RED}" ;;
        *) STATUS_COLOR="${YELLOW}" ;;
      esac
      
      printf "%-38s %-12s ${STATUS_COLOR}%-12s${NC} %-10s %-8s %-8s %-8s\n" \
        "${id:0:36}" "${type:0:12}" "${status:0:12}" "${submitted_by:0:10}" \
        "${submitted:-N/A}" "${started:-N/A}" "${completed:-N/A}"
    done
    echo ""
  fi
  
  # Query steps for the latest job
  LATEST_JOB=$(echo "$JOBS" | head -1 | cut -d'|' -f1)
  
  if [ -n "$LATEST_JOB" ]; then
    echo -e "${CYAN}Steps for Latest Job (${LATEST_JOB:0:8}...):${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    STEPS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "
      SELECT 
        step_value,
        status,
        lambda_function_name,
        records_processed,
        TO_CHAR(started_at, 'HH24:MI:SS') as started,
        TO_CHAR(completed_at, 'HH24:MI:SS') as completed,
        sqs_message_id
      FROM dtm_steps 
      WHERE job_id = '$LATEST_JOB'
      ORDER BY
        CASE step_value
          WHEN 'ValidateCustomer' THEN 1
          WHEN 'SubmitCustomer' THEN 2
          WHEN 'ValidateOrder' THEN 3
          WHEN 'SubmitOrder' THEN 4
          ELSE 5
        END;
    " 2>/dev/null || echo "")
    
    if [ -z "$STEPS" ]; then
      echo -e "${YELLOW}No steps found${NC}"
    else
      printf "%-20s %-12s %-25s %-8s %-8s %-8s\n" "Step" "Status" "Lambda" "Records" "Started" "Done"
      echo "────────────────────────────────────────────────────────────────────────────────"
      
      echo "$STEPS" | while IFS='|' read -r step_value status lambda records started completed msg_id; do
        case "$status" in
          "completed") STATUS_COLOR="${GREEN}" ;;
          "in_progress"|"delegated") STATUS_COLOR="${BLUE}" ;;
          "failed") STATUS_COLOR="${RED}" ;;
          *) STATUS_COLOR="${YELLOW}" ;;
        esac
        
        printf "%-20s ${STATUS_COLOR}%-12s${NC} %-25s %-8s %-8s %-8s\n" \
          "${step_value:0:20}" "${status:0:12}" "${lambda:0:25}" \
          "${records:-0}" "${started:-N/A}" "${completed:-N/A}"
      done
    fi
    echo ""
  fi
  
  # Summary statistics
  STATS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -F'|' -c "
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
    FROM dtm_jobs;
  " 2>/dev/null || echo "0|0|0|0|0")
  
  IFS='|' read -r total pending processing completed failed <<< "$STATS"
  
  echo -e "${CYAN}Overall Statistics:${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "Total: ${BLUE}$total${NC} | Pending: ${YELLOW}$pending${NC} | Processing: ${BLUE}$processing${NC} | Completed: ${GREEN}$completed${NC} | Failed: ${RED}$failed${NC}"
  echo ""
  
  sleep 2
done
