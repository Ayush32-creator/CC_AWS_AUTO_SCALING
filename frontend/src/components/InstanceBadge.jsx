import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Server } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Shows which server instance answered the latest request. Refreshed on every
 * navigation so you can watch the ALB spread requests across instances.
 */
export default function InstanceBadge() {
  const location = useLocation();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .instance()
      .then((data) => !cancelled && setInfo(data))
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!info) return null;
  return (
    <span className="instance" title="Instance that served the last API request">
      <span className="instance-dot" aria-hidden="true" />
      <Server size={14} aria-hidden="true" />
      Served by <code>{info.instanceId}</code>
      <span className="instance-meta">
        {info.availabilityZone} · build {info.version}
      </span>
    </span>
  );
}
