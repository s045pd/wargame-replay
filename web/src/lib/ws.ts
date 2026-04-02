type MessageHandler = (data: unknown) => void;

export class GameWebSocket {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private gameId: string;
  /** When true, onclose should NOT auto-reconnect */
  private destroyed = false;

  constructor(gameId: string) {
    this.gameId = gameId;
  }

  connect() {
    this.destroyed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws/games/${this.gameId}/stream`;
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const data = JSON.parse(e.data as string) as unknown;
      this.handlers.forEach(h => h(data));
    };
    this.ws.onclose = () => {
      if (this.destroyed) return;
      // Auto-reconnect after 2s
      setTimeout(() => this.connect(), 2000);
    };
  }

  send(cmd: { cmd: string; to?: string; speed?: number }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }

  /** Replace (not append) the message handler — safe across reconnects */
  onMessage(handler: MessageHandler) {
    this.handlers = [handler];
  }

  disconnect() {
    this.destroyed = true;
    this.ws?.close();
    this.ws = null;
  }
}
