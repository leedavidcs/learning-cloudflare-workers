import { RateLimiterClient } from "../classes/RateLimiterClient";
import { RequestUtils, WebSocketUtils } from "../utils";

const HISTORICAL_MESSAGES_LIMIT = 100;
const MESSAGE_MAX_LENGTH = 256;
const SESSION_NAME_MAX_LENGTH = 32;

interface ChatRoomSession {
	blockedMessages: string[];
	name: string | null;
	quit: boolean;
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

					await this.handleSession(server, ip);

					return new Response(null, { status: 101, webSocket: client });
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
		const session: ChatRoomSession = { blockedMessages: [], name: null, quit: false, webSocket };

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

		let receivedUserInfo: boolean = false;

		webSocket.addEventListener("message", async (msg) => {
			try {
				if (session.quit) {
					webSocket.close(1011, "WebSocket broken");

					return;
				}

				if (!limiter.checkLimit()) {
					webSocket.send(JSON.stringify({
						error: "Your IP is being rate-limited, please try again later."
					}));

					return;
				}

				// We'll only process string data for now
				if (typeof msg.data !== "string") return;

				let data = JSON.parse(msg.data);

				if (!receivedUserInfo) {
					session.name = `${data.name}` || "anonymous";

					// Don't allow people to use rediculously long names.
					if (session.name.length > SESSION_NAME_MAX_LENGTH) {
						webSocket.send(JSON.stringify({ error: "Name is too long." }));
						webSocket.close(1009, "Name is too long.");

						return;
					}

					session.blockedMessages.forEach((queued) => {
						webSocket.send(queued);
					});
					session.blockedMessages = [];

					this.broadcast(JSON.stringify({ joined: session.name }));

					webSocket.send(JSON.stringify({ ready: true }));

					receivedUserInfo = true;

					return;
				}

				data = { name: session.name, message: `${data.message}` };

				if (data.message.length > MESSAGE_MAX_LENGTH) {
					webSocket.send(JSON.stringify({ error: "Message is too long." }));

					return;
				}

				// Add timestamp, so that if we receive a bunch of messages at the same time, we'll
				// assign them sequential timestamps, so at least the ordering is maintained
				data.timestamp = Math.max(Date.now(), this.lastTimestamp + 1);
				this.lastTimestamp = data.timestamp;

				// Broadcast the mssage to all other WebSockets
				let dataStr = JSON.stringify(data);
				
				this.broadcast(dataStr);

				// Save message
				let key = new Date(data.timestamp).toISOString();

				await this.storage.put(key, dataStr);
			} catch (err) {
				if (!(err instanceof Error)) {
					webSocket.send(JSON.stringify({ error: "Unexpected Error" }));

					return;
				}

				webSocket.send(JSON.stringify({ error: err.stack }))
			}
		});

		const closeHandler = () => {
			session.quit = true;

			this.sessions = this.sessions.filter((member) => member !== session);

			if (!session.name) return;

			this.broadcast(JSON.stringify({ quit: session.name }));

		};

		webSocket.addEventListener("close", closeHandler);
		webSocket.addEventListener("error", closeHandler);
	}

	broadcast(message: string): void {
		const quitters: ChatRoomSession[] = [];

		// Iterate over all the sessions sending them messages.
		this.sessions = this.sessions.filter((session) => {
			if (!session.name) {
				// This session hasn't sent the initial user info message yet, so we're not sending
				// them messages yet (no secret lurking!). Queue the message to be sent later
				session.blockedMessages.push(message);

				return true;
			}

			try {
				session.webSocket.send(message);

				return true;
			} catch {
				// Connection is dead. Remove it from the list and arrage to notify everyone below
				session.quit = true;
				quitters.push(session);

				return false;
			}
		});

		quitters.forEach((quitter) => {
			if (!quitter.name) return;

			this.broadcast(JSON.stringify({ quit: quitter.name }));
		});
	}
}
