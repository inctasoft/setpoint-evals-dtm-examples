#!/bin/bash
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=000000000000
export AWS_SQS_ENDPOINT=http://localhost:4567
export ORCHESTRATOR_CALLBACK_URL=http://localhost:3002
export DEBUG_SERVER_MODE=true
export DTM_DB_HOST=localhost
export DTM_DB_PORT=5448
export DTM_DB_USER=dtm_user
export DTM_DB_PASSWORD=your_password
export DTM_DB_NAME=dtm
export ORDER_PROCESSING_DB_HOST=localhost
export ORDER_PROCESSING_DB_PORT=5449
export ORDER_PROCESSING_DB_USER=order_user
export ORDER_PROCESSING_DB_PASSWORD=order_pass
export ORDER_PROCESSING_DB_NAME=order_processing_db
export IOT_SENSOR_DB_HOST=localhost
export IOT_SENSOR_DB_PORT=5450
export IOT_SENSOR_DB_USER=iot_user
export IOT_SENSOR_DB_PASSWORD=iot_pass
export IOT_SENSOR_DB_NAME=iot_sensor_pipeline_db
export INFRA_PROVISIONING_DB_HOST=localhost
export INFRA_PROVISIONING_DB_PORT=5451
export INFRA_PROVISIONING_DB_USER=infra_user
export INFRA_PROVISIONING_DB_PASSWORD=infra_pass
export INFRA_PROVISIONING_DB_NAME=infra_provisioning_db

cd "$(dirname "$0")"
exec npx tsx --require reflect-metadata tools/sqs-poller/src/poller.ts
