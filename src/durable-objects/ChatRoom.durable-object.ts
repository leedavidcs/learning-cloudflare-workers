import { RateLimiterClient } from "../classes";
import { RequestUtils, WebSocketUtils } from "../utils";

const HISTORICAL_MESSAGES_LIMIT = 100;

interface ChatRoomSession {
	blockedMessages: string[];
	name: string | null;
	webSocket: WebSocket;
}

export class ChatRoomDurableObject implements DurableObject {
	env: Env;
	lastTimestamp: number = 0;
	sessions: ChatRoomSession[] = [];
	storage: DurableObjectStorage;

	constructor(state: DurableObjectState, env: Env) {
		this.env = env;
		this.storage = state.storage;
	}

	async fetch(request: Request): Promise<Response> {
		return await RequestUtils.handleErrors(request, async () => {
			const url = new URL(request.url);

			switch (url.pathname) {
				case "/websocket": {
					if (!RequestUtils.isWebSocketRequest(request)) {
						return new Response("Expected websocket", { status: 400 });
					}

					const ip = RequestUtils.getRequestIp(request);

					const [client, server] = WebSocketUtils.makeWebSocketPair();


				}
				default:
					return new Response("Not found", { status: 404 });
			}
		});
	}

	async handleSession(webSocket: WebSocket, ip: string): Promise<void> {
		// Accept our end of the WebSocket. This tells the runtime that we'll be terminating the
		// WebSocket in JavaScript, not sending it elsewhere.
		webSocket.accept();

		const limiterId = this.env.limiters.idFromName(ip);
		const limiter = new RateLimiterClient(
			() => this.env.limiters.get(limiterId),
			(err) => webSocket.close(1011, err.stack)
		);

		// Create our session and add it to the sessions list.
		// We don't send any messages to the client until it has sent us the initial user info
		// message. Until then, we will queue messages in `session.blockedMessages`
		const session: ChatRoomSession = { blockedMessages: [], name: null, webSocket };

		this.sessions.push(session);

		// Queue "joined" mesages for all online users, to populate the client's roster
		this.sessions.forEach((otherSession) => {
			if (!otherSession.name) return;

			session.blockedMessages.push(JSON.stringify({ joined: otherSession.name }));
		});

		// Load the last 100 messages from the chat history stored on disk, and send them to the
		// client
		const storage = await this.storage.list<string>({
			reverse: true,
			limit: HISTORICAL_MESSAGES_LIMIT
		});
		
		Array.from(storage.values()).reverse().forEach((message) => {
			session.blockedMessages.push(message);
		});


	}
}
