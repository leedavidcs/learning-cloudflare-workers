/**
 * @description Implements rate-limiting logic on the caller's side
 */
export class RateLimiterClient {
	private getLimiterStub: () => DurableObjectStub;
	// When `inCooldown` is true, the rate limit is currently applied and checkLimit() will return
	// false
	private inCooldown: boolean = false;
	private limiter: DurableObjectStub;
	private reportError: (err: Error) => void;

	/**
	 * 
	 * @param getLimiterStub Returns a new RateLimiter durable-object stub that manages the limit.
	 * This may be called multiple times as needed to reconnect, if the connection is lost.
	 * @param reportError Is called when something goes wrong and the rate-limiter is broken. It
	 * should probably disconnect the client, so that they can reconnect and start over.
	 */
	constructor(getLimiterStub: () => DurableObjectStub, reportError: (err: Error) => void) {
		this.getLimiterStub = getLimiterStub;
		this.reportError = reportError;

		// Get the initial RateLimiter durable-object stub
		this.limiter = getLimiterStub();
	}

	public checkLimit(): boolean {
		if (this.inCooldown) return false;

		this.inCooldown = true;
		this.callLimiter();

		return true;
	}

	private async callLimiter(): Promise<void> {
		try {
			let response: Response;

			try {
				/**
				 * !HACK
				 * @description Currently, fetch() needs a valid URL even though it's not actually
				 * going to the internet. This is a limitation of CloudFlare as of writing, which
				 * may change in the future. But for now, we need to provide a dummy URL that will
				 * be ignored at the other end anyways.
				 * @author David Lee
				 * @date July 31, 2022
				 */
				response = await this.limiter.fetch("https://dummy-url", { method: "POST" });
			} catch (err) {
				/**
				 * !HACK
				 * @description `fetch()` threw an exception. This is probably because the limiter
				 * has been disconnected. Stubs implement E-order semantics, meaning that calls to
				 * the same stub are delivered to the remote object in order, until the stub
				 * becomes disconnected, after which point all further calls fail. This guarantee
				 * makes a lot of complex interaction patterns easier, but it means we must be
				 * prepared for the occasional disconnect, as networks are inherently unreliable.
				 * 
				 * Anyways, get a new limiter and try again. If it fails again, something else is
				 * probably wrong.
				 * @author David Lee
				 * @date July 31, 2022
				 */
				this.limiter = this.getLimiterStub();

				response = await this.limiter.fetch("https://dummy-url", { method: "POST" });
			}
		} catch (err) {
			const error = err instanceof Error ? err : new Error("Unidentified error");

			this.reportError(error);
		}
	}
}
