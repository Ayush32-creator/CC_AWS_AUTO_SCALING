// Reads the EC2 instance ID and Availability Zone from the Instance Metadata
// Service (IMDSv2: session token first, then the metadata request). Used by
// GET /api/instance so the UI can show which instance served a request.

const IMDS = 'http://169.254.169.254/latest';

async function fetchText(url, options) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(500) });
  if (!res.ok) throw new Error(`IMDS ${url} returned ${res.status}`);
  return res.text();
}

export function createInstanceMetadata({ enabled, appVersion, logger }) {
  let cached;

  async function lookup() {
    if (!enabled) return { instanceId: 'local', availabilityZone: 'local' };
    try {
      const token = await fetchText(`${IMDS}/api/token`, {
        method: 'PUT',
        headers: { 'X-aws-ec2-metadata-token-ttl-seconds': '21600' },
      });
      const headers = { 'X-aws-ec2-metadata-token': token };
      const [instanceId, availabilityZone] = await Promise.all([
        fetchText(`${IMDS}/meta-data/instance-id`, { headers }),
        fetchText(`${IMDS}/meta-data/placement/availability-zone`, { headers }),
      ]);
      return { instanceId, availabilityZone };
    } catch (err) {
      logger?.warn({ err }, 'Instance metadata unavailable');
      return { instanceId: 'unknown', availabilityZone: 'unknown' };
    }
  }

  return {
    async get() {
      // Metadata never changes for the life of the instance, so cache it.
      cached ??= await lookup();
      return { ...cached, version: appVersion };
    },
  };
}
