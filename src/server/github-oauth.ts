/**
 * GitHub Device Flow OAuth
 *
 * Allows users to authenticate with GitHub via browser-based OAuth
 * instead of manually creating and pasting Personal Access Tokens.
 *
 * Flow:
 * 1. Request a device code from GitHub
 * 2. Show the user a URL + code to enter in their browser
 * 3. Poll GitHub until the user authorizes
 * 4. Receive an access token automatically
 *
 * Uses GitHub's Device Flow which doesn't require a client_secret,
 * making it suitable for CLI/desktop apps.
 *
 * NOTE: Requires a GitHub OAuth App with Device Flow enabled.
 * We use a public client_id since this is a CLI tool.
 */

// ── GitHub Device Flow ─────────────────────────────────────────────────────

// Public client_id for Orchestra AI (Device Flow — no client_secret needed)
// Users should replace this with their own OAuth App's client_id if self-hosting
const GITHUB_CLIENT_ID = "Iv1.orchestra_ai_dev";

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface ErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Step 1: Request a device code from GitHub.
 * Returns the user_code and verification_uri to show to the user.
 */
export async function requestDeviceCode(clientId?: string): Promise<DeviceCodeResponse> {
  const id = clientId || GITHUB_CLIENT_ID;
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: id,
      scope: "repo workflow",
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub device code request failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

/**
 * Step 2: Poll GitHub for the access token.
 * The user must visit verification_uri and enter user_code in their browser.
 * This function polls until the user authorizes or the code expires.
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  clientId?: string,
): Promise<string> {
  const id = clientId || GITHUB_CLIENT_ID;
  const startTime = Date.now();
  const expiresAt = startTime + expiresIn * 1000;
  let pollInterval = Math.max(interval, 5) * 1000; // minimum 5 seconds

  while (Date.now() < expiresAt) {
    await sleep(pollInterval);

    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: id,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!response.ok) {
      throw new Error(`GitHub token poll failed: ${response.status}`);
    }

    const data = await response.json() as TokenResponse | ErrorResponse;

    if ("access_token" in data) {
      return data.access_token;
    }

    const error = data as ErrorResponse;
    switch (error.error) {
      case "authorization_pending":
        // User hasn't authorized yet — keep polling
        continue;
      case "slow_down":
        // GitHub asks us to slow down — increase interval by 5s
        pollInterval += 5000;
        continue;
      case "expired_token":
        throw new Error("Authorization code expired. Please try again.");
      case "access_denied":
        throw new Error("User denied authorization.");
      default:
        throw new Error(`GitHub OAuth error: ${error.error} — ${error.error_description || "unknown"}`);
    }
  }

  throw new Error("Authorization timed out. Please try again.");
}

/**
 * Full Device Flow: request code, show to user, poll for token.
 * Returns the access token string.
 *
 * @param onShowCode - Callback to display the code and URL to the user
 */
export async function githubDeviceFlow(
  onShowCode: (userCode: string, verificationUri: string) => void,
  clientId?: string,
): Promise<string> {
  const deviceResponse = await requestDeviceCode(clientId);
  onShowCode(deviceResponse.user_code, deviceResponse.verification_uri);
  return pollForToken(
    deviceResponse.device_code,
    deviceResponse.interval,
    deviceResponse.expires_in,
    clientId,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
