#!/bin/sh
set -e

echo "🤖 Starting Dev Acknowledgement Simulator..."
echo "📝 Environment: ${NODE_ENV:-development}"
echo "🌐 Kafka Brokers: ${KAFKA_BROKERS:-kafka:29092}"
echo "🔌 Port: ${PORT:-3001}"

# Start the application
exec node dist/main.js

