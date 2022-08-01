// @ts-ignore
import indexHtml from "./public/index.html";

export { ChatRoomDurableObject, RateLimiterDurableObject } from "./durable-objects";

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

		// return static HTML
		return new Response("Not found", { status: 404 });
	}
};

export default worker;
