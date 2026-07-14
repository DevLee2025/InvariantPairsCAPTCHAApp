// An <img> that retries on error. Fast slider scrubbing in Review cancels
// in-flight image requests (HTTP/1.1 connection limit); without a retry those
// tiles stay broken. This re-attempts the load a few times with backoff.

import { useEffect, useState, type ImgHTMLAttributes } from "react";

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  maxRetries?: number;
}

export function RetryImg({ src, maxRetries = 4, ...rest }: Props) {
  const [n, setN] = useState(0);

  // Reset the retry counter whenever the source changes.
  useEffect(() => setN(0), [src]);

  const url = n === 0 ? src : `${src}${src.includes("?") ? "&" : "?"}retry=${n}`;

  return (
    <img
      {...rest}
      src={url}
      onError={() => {
        if (n < maxRetries) {
          window.setTimeout(() => setN((v) => v + 1), 200 * (n + 1));
        }
      }}
    />
  );
}
