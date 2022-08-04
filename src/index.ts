// @ts-ignore
import indexHtml from "./public/index.html";

export {
	ChatRoomDurableObject,
	RateLimiterDurableObject,
} from "./durable-objects";

// Screw it, getting lazy. Just copy-paste this from Cloudflare's example straight-up
async function handleApiRequest(path: string[], request: Request, env: Env) {
	// We've received at API request. Route the request based on the path.

	switch (path[0]) {
		case "room": {
			// Request for `/api/room/...`.

			if (!path[1]) {
				// The request is for just "/api/room", with no ID.
				if (request.method == "POST") {
					// POST to /api/room creates a private room.
					const id = env.rooms.newUniqueId();

					return new Response(id.toString(), {
						headers: { "Access-Control-Allow-Origin": "*" },
					});
				}

				return new Response("Method not allowed", { status: 405 });
			}

			// OK, the request is for `/api/room/<name>/...`. It's time to route to the Durable Object
			// for the specific room.
			const name = path[1];

			// Each Durable Object has a 256-bit unique ID. IDs can be derived from string names, or
			// chosen randomly by the system.
			let id;
			if (name.match(/^[0-9a-f]{64}$/)) {
				// The name is 64 hex digits, so let's assume it actually just encodes an ID. We use this
				// for private rooms. `idFromString()` simply parses the text as a hex encoding of the raw
				// ID (and verifies that this is a valid ID for this namespace).
				id = env.rooms.idFromString(name);
			} else if (name.length <= 32) {
				// Treat as a string room name (limited to 32 characters). `idFromName()` consistently
				// derives an ID from a string.
				id = env.rooms.idFromName(name);
			} else {
				return new Response("Name too long", { status: 404 });
			}

			let roomObject = env.rooms.get(id);

			// Compute a new URL with `/api/room/<name>` removed. We'll forward the rest of the path
			// to the Durable Object.
			let newUrl = new URL(request.url);
			newUrl.pathname = "/" + path.slice(2).join("/");

			return roomObject.fetch(newUrl.toString(), request);
		}

		default:
			return new Response("Not found", { status: 404 });
	}
}

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const worker: ExportedHandler<Env> = {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.slice(1).split("/");

		if (!path[0]) {
			// return static HTML
			return new Response(indexHtml, {
				headers: { "content-type": "text/html;charset=UTF-8" },
			});
		}

		switch (path[0]) {
			case "api":
				// This is a request for `/api/...`, call the API handler.
				return handleApiRequest(path.slice(1), request, env);

			default:
				return new Response("Not found", { status: 404 });
		}
	},
};

export default worker;
