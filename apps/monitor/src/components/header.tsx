interface HeaderProps {
  connected: boolean;
}

export function Header({ connected }: HeaderProps) {
  return (
    <div class="header">
      {'╔════════════════════════════════════════════════════════════════════════════════╗\n'}
      {'║   '}
      <span class="title">DTM Operations Dashboard</span>
      {'                                              '}
      <span class={`live ${connected ? '' : 'disconnected'}`}>
        {connected ? '● LIVE' : '○ OFFLINE'}
      </span>
      {'║\n'}
      {'╚════════════════════════════════════════════════════════════════════════════════╝'}
    </div>
  );
}
