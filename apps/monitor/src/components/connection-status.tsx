interface ConnectionStatusProps {
  connected: boolean;
  reconnecting: boolean;
}

export function ConnectionStatus({ connected, reconnecting }: ConnectionStatusProps) {
  const statusClass = connected ? 'connected' : reconnecting ? 'reconnecting' : 'disconnected';
  const label = connected ? 'Connected' : reconnecting ? 'Reconnecting...' : 'Disconnected';

  return (
    <span>
      <span class={`connection-dot ${statusClass}`} />
      {label}
    </span>
  );
}
