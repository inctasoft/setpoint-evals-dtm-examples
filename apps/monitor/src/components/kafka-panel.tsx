import { useState, useEffect, useRef } from 'preact/hooks';
import type { KafkaTopicSummary } from '../types/api';

const POLL_INTERVAL_MS = 5000;

/**
 * "Kafka Topics" tab — GET /api/v1/kafka/topics (SE-20). Topic list + a cheap
 * approximate retained-message count only (no message browsing — the backend
 * deliberately never subscribes/consumes, per the task brief's "topic list
 * only" fallback: consuming would risk stealing messages from the real
 * pipeline's own consumer groups).
 */
export function KafkaPanel() {
  const [topics, setTopics] = useState<KafkaTopicSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const res = await fetch('/api/api/v1/kafka/topics');
        if (res.ok) {
          const data = await res.json();
          setTopics(Array.isArray(data.topics) ? data.topics : []);
          setConnected(!!data.connected);
        }
      } catch {
        // retry on next poll
      } finally {
        setLoading(false);
      }
    };

    fetchTopics();
    pollRef.current = setInterval(fetchTopics, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, []);

  if (loading) {
    return <div class="empty-state">Loading topics…</div>;
  }

  if (!connected) {
    return <div class="empty-state">Kafka broker not reachable — topics unavailable.</div>;
  }

  if (topics.length === 0) {
    return <div class="empty-state">No Kafka topics found.</div>;
  }

  return (
    <table class="sqs-table">
      <thead>
        <tr>
          <th>Topic</th>
          <th>Partitions</th>
          <th>~Messages</th>
        </tr>
      </thead>
      <tbody>
        {topics.map((t) => (
          <tr key={t.name}>
            <td>{t.name}</td>
            <td>{t.partitions}</td>
            <td>{t.approxMessageCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
