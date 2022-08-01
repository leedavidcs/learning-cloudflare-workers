import { RequestUtils } from "../utils";

const RATE_LIMIT_INTERVAL = 5;
const RATE_LIMIT_GRACE_PERIOD = 20;

export class RateLimiterDurableObject implements DurableObject {
	private nextAllowedTime = 0;

	async fetch(request: Request): Promise<Response> {
		return await RequestUtils.handleErrors(request, async () => {
			const now = Date.now() / 1_000;

			this.nextAllowedTime = Math.max(now, this.nextAllowedTime);

			if (request.method === "POST") {
				this.nextAllowedTime += RATE_LIMIT_INTERVAL;
			}

			const cooldown = Math.max(0, this.nextAllowedTime - now - RATE_LIMIT_GRACE_PERIOD);

			return new Response(cooldown.toString());
		});
	}
}
